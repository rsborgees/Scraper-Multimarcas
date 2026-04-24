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
const { formatRennerMessage, formatRiachueloMessage } = require('./utils/messageFormatter');

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
            '--disable-blink-features=AutomationControlled',
            '--disable-http2'
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

        // Rastreador de metas atingidas por loja
        const currentQuotas = quotas ? { ...quotas } : null;

        for (const item of itemsToProcess) {
            const store = detectStore(item.fileName);
            
            // Pula se a loja não for reconhecida ou se a cota para ela já estiver zerada
            if (!store || (currentQuotas && (currentQuotas[store] || 0) <= 0)) {
                continue;
            }

            const parser = getParser(store);

            if (!parser) continue;

            console.log(`🕵️ [${store.toUpperCase()}] Processando: ${item.id}`);
            
            let scrapedItems = [];
            for (let i = 0; i < item.skus.length; i++) {
                const sku = item.skus[i];
                const data = await parser(page, sku);
                
                if (data) {
                    const size = item.tamanhosQueUsei && item.tamanhosQueUsei[i] 
                        ? item.tamanhosQueUsei[i] 
                        : (item.tamanhosQueUsei && item.tamanhosQueUsei[0] ? item.tamanhosQueUsei[0] : null);
                        
                    if (size) {
                        data.tamanhoQueUsei = size;
                    }
                    
                    data.url = await generateAwinLink(data.url, store);
                    scrapedItems.push(data);
                }
            }

            if (scrapedItems.length > 0) {
                const isConjunto = item.skus.length > 1;
                
                // Usamos a base do primeiro item e criamos um payload único
                let finalData = { ...scrapedItems[0] };
                
                finalData.imageUrl = item.driveFileId ? `https://drive.google.com/uc?export=download&id=${item.driveFileId}` : null;
                finalData.store = store;
                finalData.driveId = item.id;
                finalData.isConjunto = isConjunto;

                if (isConjunto) {
                    finalData.nome = "Conjunto";
                    finalData.conjuntoItems = scrapedItems;
                }

                if (store === 'renner') {
                    finalData.message = formatRennerMessage(isConjunto ? scrapedItems : finalData);
                } else if (store === 'riachuelo') {
                    finalData.message = formatRiachueloMessage(isConjunto ? scrapedItems : finalData);
                }

                if (currentQuotas) {
                    currentQuotas[store]--;
                }

                rawResults.push(finalData);
                const imageStatus = finalData.imageUrl ? 'Drive ✅' : 'Falha no Drive ❌ (Sem ID)';
                console.log(`✅ [${store.toUpperCase()}] Sucesso: ${item.id} | Imagem: ${imageStatus} | Conjunto: ${isConjunto ? 'Sim' : 'Não'}`);

                // Para quando TODAS as quotas forem atingidas (ou pool esgotar)
                const allQuotasMet = currentQuotas 
                    ? Object.values(currentQuotas).every(q => q <= 0) 
                    : rawResults.length >= (parseInt(process.env.DAILY_QUOTA) || 10);

                if (allQuotasMet) {
                    console.log(`🎯 [Orchestrator] Todas as metas atingidas. Encerrando coleta.`);
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
        
        // Não processa subpastas recursivamente por enquanto
        // apenas os arquivos diretos nessa pasta.
        allFiles.forEach(file => {
            if (file.mimeType !== 'application/vnd.google-apps.folder') {
                const skuMatches = file.name.match(/\d{5,}/g);
                if (skuMatches && skuMatches.length > 0) {
                    const idKey = skuMatches.join('-'); // Junta os SKUs se for um conjunto
                    if (!resultsMap.has(idKey)) {
                        // Extração do tamanho da modelo (P, M, G, etc)
                        // Busca por letras isoladas ou múltiplos tamanhos
                        const sizeMatches = file.name.match(/\b(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG)\b/ig);
                        const tamanhosQueUsei = sizeMatches ? sizeMatches.map(s => s.toUpperCase()) : [];

                        resultsMap.set(idKey, {
                            id: idKey,
                            skus: skuMatches,
                            driveFileId: file.id,
                            fileName: file.name.toLowerCase(),
                            tamanhosQueUsei: tamanhosQueUsei
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
