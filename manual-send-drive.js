const { google } = require('googleapis');
const axios = require('axios');
const puppeteer = require('puppeteer');
require('dotenv').config();

const { parseProductRenner } = require('./renner/parser');
const { parseProductCEA } = require('./cea/parser');
const { parseProductRiachuelo } = require('./riachuelo/parser');
const { generateAwinLink } = require('./utils/affiliateManager');
const { formatRennerMessage } = require('./utils/messageFormatter');

async function manualSend3FromDrive() {
    console.log("Iniciando envio manual de 3 peças a partir do Google Drive...");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    let allFiles = [];
    try {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType)',
            pageSize: 200
        });
        allFiles = response.data.files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
    } catch (e) {
        console.error("Erro na API do Drive:", e.message);
        return;
    }

    if (allFiles.length === 0) {
        console.log("Nenhum arquivo encontrado no Drive!");
        return;
    }

    // Pega os 3 primeiros arquivos que não sejam Riachuelo (pra contornar política de privacidade do site deles de teste)
    const itemsToProcess = allFiles.filter(f => !f.name.toLowerCase().includes('riachuelo')).slice(0, 3);
    console.log(`Selecionados ${itemsToProcess.length} arquivos para extração...`);

    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const rawResults = [];

    for (const file of itemsToProcess) {
        const textNome = file.name.toLowerCase();
        
        // Detect store
        let store = null;
        if (textNome.includes('renner')) store = 'renner';
        else if (textNome.includes('riachuelo')) store = 'riachuelo';
        else if (textNome.includes('cea') || textNome.includes('c&a')) store = 'cea';
        else store = 'riachuelo'; // Assume Riachuelo/Renner fallback

        let parser = null;
        if (store === 'renner') parser = parseProductRenner;
        if (store === 'riachuelo') parser = parseProductRiachuelo;
        if (store === 'cea') parser = parseProductCEA;

        const skuMatch = file.name.match(/\d{6,}/);
        if (!skuMatch || !parser) continue;
        
        let idFromFileName = skuMatch[0];
        console.log(`[Extraindo] SKU ${idFromFileName} (${store})...`);

        try {
            const data = await parser(page, idFromFileName);
            if (data) {
                const originalUrl = data.url;
                data.url = await generateAwinLink ? await generateAwinLink(originalUrl, store) : originalUrl;
                
                // Set the REAL driveImageUrl
                data.imageUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;

                if (store === 'renner' && formatRennerMessage) {
                    data.message = formatRennerMessage(data);
                }

                rawResults.push({ ...data, store });
                console.log(`[Sucesso] ${data.nome} | Imagem linkada ao Drive ✅`);
            } else {
                console.log(`[Falha] Elemento não pôde ser parseado da loja.`);
            }
        } catch(e) {
            console.log(`Erro parseando ${idFromFileName}: ${e.message}`);
        }
    }

    await browser.close();

    if (rawResults.length > 0) {
        console.log(`Enviando ${rawResults.length} peças reais do Drive para o Webhook...`);
        try {
            const response = await axios.post(process.env.WEBHOOK_URL, rawResults);
            console.log(`🎉 Webhook recebido com Sucesso! Status: ${response.status}`);
        } catch (error) {
            console.error('❌ [Webhook] Falha no envio:', error.message);
        }
    } else {
        console.log("Nenhum item conseguiu ser parseado com sucesso. O envio foi cancelado.");
    }
}

manualSend3FromDrive();
