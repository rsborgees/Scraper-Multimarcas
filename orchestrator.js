const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { google } = require('googleapis');

const { getSelectionPool } = require('./utils/historyManager');
const { parseProductRenner } = require('./renner/parser');
const { parseProductCEA } = require('./cea/parser');
const { parseProductRiachuelo } = require('./riachuelo/parser');
const { generateAwinLink } = require('./utils/affiliateManager');
const { formatRennerMessage } = require('./utils/messageFormatter');

/**
 * Função principal de orquestração
 * @param {Object} quotas - Metas calculadas pelo Scheduler (opcional por enquanto)
 */
async function runAllScrapers(quotas = null) {
    console.log('🚀 [Orchestrator] Iniciando execução por fases...');
    
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const rawResults = [];

    try {
        // --- PHASE 1: GOOGLE DRIVE PRIORITY ---
        console.log('📂 [PHASE 1] Iniciando prioridade da API do Google Drive...');
        const driveItems = await fetchDriveItems();
        const pool = getSelectionPool(driveItems);

        // Usamos um pool de avaliação maior pois muitos podem ser pulados ou falhar
        const itemsToProcess = pool.slice(0, 100);

        for (const item of itemsToProcess) {
            const store = detectStore(item.fileName);
            // Pula imediatamente se a cota para a loja for estritamente zero
            if (quotas && quotas[store] === 0) {
                continue;
            }

            const parser = getParser(store);

            if (!parser) continue;

            console.log(`🕵️ [${store.toUpperCase()}] Processando: ${item.id}`);
            const data = await parser(page, item.id);
            
            if (data) {
                // Adiciona o tamanho da modelo extraído do Drive se disponível
                if (item.tamanhoQueUsei) {
                    data.tamanhoQueUsei = item.tamanhoQueUsei;
                }
                // Parametrização Awin (Atualmente apenas Renner suportada no utility)
                const originalUrl = data.url;
                data.url = await generateAwinLink(originalUrl, store);

                // Garantir que a imagem NUNCA venha da loja
                data.imageUrl = null;
                
                // Usar APENAS o link do Drive se disponível
                if (item.driveFileId) {
                    data.imageUrl = `https://drive.google.com/uc?export=download&id=${item.driveFileId}`;
                }


                // Gerar mensagem formatada APENAS para Renner (solicitação do usuário)
                if (store === 'renner') {
                    data.message = formatRennerMessage(data);
                }
                
                rawResults.push({ ...data, store, driveId: item.id });
                const imageStatus = data.imageUrl ? 'Drive ✅' : 'Falha no Drive ❌ (Sem ID)';
                console.log(`✅ [${store.toUpperCase()}] Sucesso: ${item.id} | Imagem: ${imageStatus}`);

                // Para imediatamente ao atingir o total requisitado pelas quotas
                const targetTotal = quotas ? Object.values(quotas).filter(v => v > 0).reduce((a, b) => a + b, 0) : (parseInt(process.env.DAILY_QUOTA) || 10);
                if (rawResults.length >= targetTotal) {
                    console.log(`🎯 [Orchestrator] Meta atingida (${rawResults.length}/${targetTotal}). Encerrando coleta.`);
                    break;
                }
            }
        }

        // --- PHASE 2: REGULAR SCRAPPING (Placeholder para expansão futura) ---
        // Aqui entrariam raspagens de "Novidades" se as quotas não fossem atingidas no Drive.

    } catch (error) {
        console.error('💥 [Orchestrator] Erro fatal:', error.message);
    } finally {
        await browser.close();
    }

    return rawResults;
}

/**
 * Utilitários Internos
 */

async function fetchDriveItems() {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!refreshToken) {
        console.error('❌ ERRO FATAL: GOOGLE_REFRESH_TOKEN não encontrado na .env!');
        console.error('👉 Por favor, execute o painel de configuração: node generate-token.js');
        return [];
    }

    try {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        
        let allFiles = [];
        let pageToken = null;

        console.log(`📂 [Drive API] Buscando arquivos na pasta: ${folderId}`);

        do {
            const response = await drive.files.list({
                q: `'${folderId}' in parents and trashed = false`,
                fields: 'nextPageToken, files(id, name, mimeType)',
                pageToken: pageToken,
                pageSize: 1000
            });
            
            allFiles = allFiles.concat(response.data.files);
            pageToken = response.data.nextPageToken;
        } while (pageToken);

        const resultsMap = new Map();
        
        // Suporte a subpastas: se o usuário tiver subpastas, não vamos pegar recursivamente agora
        // apenas os arquivos diretos nessa pasta.
        allFiles.forEach(file => {
            if (file.mimeType !== 'application/vnd.google-apps.folder') {
                const skuMatch = file.name.match(/\d{6,}/);
                if (skuMatch) {
                    const sku = skuMatch[0];
                    if (!resultsMap.has(sku)) {
                        // Extração do tamanho da modelo (P, M, G, etc)
                        // Busca por letras isoladas ou tamanhos comuns entre hífens ou espaços
                        const sizeMatch = file.name.match(/\b(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG)\b/i);
                        const tamanhoQueUsei = sizeMatch ? sizeMatch[1].toUpperCase() : null;

                        resultsMap.set(sku, {
                            id: sku,
                            driveFileId: file.id,
                            fileName: file.name.toLowerCase(),
                            tamanhoQueUsei: tamanhoQueUsei
                        });
                    }
                }
            }
        });

        console.log(`✅ [Drive API] Encontrados ${resultsMap.size} SKUs válidos!`);
        return Array.from(resultsMap.values());
    } catch (e) {
        console.error('❌ Erro na API do Drive:', e.message);
        return [];
    }
}

function detectStore(fileName) {
    const name = fileName.toLowerCase();
    if (name.includes('renner')) return 'renner';
    if (name.includes('riachuelo')) return 'riachuelo';
    if (name.includes('cea') || name.includes('c&a')) return 'cea';
    return null;
}

function getParser(store) {
    if (store === 'renner') return parseProductRenner;
    if (store === 'cea') return parseProductCEA;
    if (store === 'riachuelo') return parseProductRiachuelo;
    return null;
}

module.exports = { runAllScrapers };
