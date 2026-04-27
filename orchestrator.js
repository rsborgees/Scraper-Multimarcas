/**
 * Orquestrador Principal do Scraper 2.0
 *
 * Responsável por:
 * 1. Receber limites por loja (ex: { renner: 3, riachuelo: 1 })
 * 2. Buscar todos os arquivos da pasta única do Google Drive
 * 3. Separar arquivos por loja com base no nome do arquivo
 * 4. Parsear produtos respeitando os limites por loja
 * 5. Retornar pool bruto de produtos (nunca bloqueia por quota incompleta)
 */

'use strict';

const puppeteer = require('puppeteer');
const { google } = require('googleapis');
require('dotenv').config();

const { parseProductRenner } = require('./renner/parser');
const { parseProductRiachuelo } = require('./riachuelo/parser');
const { parseProductCea } = require('./cea/parser');
const { generateAwinLink } = require('./utils/affiliateManager');
const { getSelectionPool } = require('./utils/historyManager');
const { formatRennerMessage, formatRiachueloMessage, formatCeaMessage } = require('./utils/messageFormatter');

// ─── Google Drive ─────────────────────────────────────────────────────────────

function buildDriveClient() {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'urn:ietf:wg:oauth:2.0:oob'
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return google.drive({ version: 'v3', auth });
}

/**
 * Lista TODOS os arquivos da pasta do Drive e classifica por loja.
 * Retorna: { renner: [...], riachuelo: [...], cea: [...] }
 * Cada item: { id: driveFileId, fileName: 'nome.jpg', productId: '12345', store: 'renner' }
 */
async function listDriveFilesByStore() {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
        console.error('❌ [Drive] GOOGLE_DRIVE_FOLDER_ID não configurado.');
        return {};
    }

    let files = [];
    try {
        const drive = buildDriveClient();
        let pageToken = null;
        do {
            const res = await drive.files.list({
                q: `'${folderId}' in parents and trashed = false`,
                fields: 'nextPageToken, files(id, name)',
                pageSize: 1000,
                pageToken: pageToken || undefined
            });
            files = files.concat(res.data.files || []);
            pageToken = res.data.nextPageToken;
        } while (pageToken);

        console.log(`📂 [Drive] ${files.length} arquivos encontrados na pasta.`);
    } catch (err) {
        console.error(`❌ [Drive] Erro ao listar arquivos: ${err.message}`);
        return {};
    }

    // Classifica por loja com base no nome do arquivo
    const byStore = { renner: [], riachuelo: [], cea: [] };

    files.forEach(f => {
        const nameLower = (f.name || '').toLowerCase();
        
        // Remove extensão
        let cleanName = f.name.replace(/\.[^.]+$/, '');
        let store = 'renner'; // Default

        // Identifica a loja e remove o nome da loja do ID
        if (nameLower.includes('riachuelo') || nameLower.includes('ria')) {
            store = 'riachuelo';
            cleanName = cleanName.replace(/riachuelo/i, '').replace(/ria/i, '');
        } else if (nameLower.includes('cea') || nameLower.includes('c&a')) {
            store = 'cea';
            cleanName = cleanName.replace(/cea/i, '').replace(/c&a/i, '');
        } else if (nameLower.includes('renner')) {
            store = 'renner';
            cleanName = cleanName.replace(/renner/i, '');
        }

        // O que sobrou (removendo espaços extras) é o ID completo
        const productId = cleanName.trim();

        // Só processa se sobrar algo que pareça um ID (pelo menos 4 caracteres)
        if (productId.length < 4) return;

        const item = { 
            id: f.id, 
            fileName: f.name, 
            productId, 
            store 
        };

        byStore[store].push(item);
    });

    Object.entries(byStore).forEach(([store, items]) => {
        console.log(`   📁 ${store}: ${items.length} arquivos`);
    });

    return byStore;
}

// ─── Parsers por loja ─────────────────────────────────────────────────────────

const PARSERS = {
    renner: parseProductRenner,
    riachuelo: parseProductRiachuelo,
    cea: parseProductCea
};

// ─── Função Principal ─────────────────────────────────────────────────────────

/**
 * Executa os scrapers para todas as lojas com limite por loja.
 *
 * IMPORTANTE: Nunca bloqueia — se uma loja não tiver produtos suficientes,
 * retorna o que conseguiu. A quota é um alvo, não um bloqueio.
 *
 * @param {Object} storeLimits - Ex: { renner: 3, riachuelo: 1, cea: 0 }
 * @returns {Promise<Array>} - Pool bruto de produtos parseados
 */
async function runAllScrapers(storeLimits = {}) {
    const allProducts = [];

    // Filtra lojas ativas (limit > 0) com parser disponível
    const activeStores = Object.entries(storeLimits)
        .filter(([store, limit]) => limit > 0 && PARSERS[store]);

    if (activeStores.length === 0) {
        console.log('ℹ️ [Orchestrator] Nenhuma loja ativa para esta rodada.');
        return [];
    }

    console.log(`\n🚀 [Orchestrator] Iniciando coleta. Alvos: ${JSON.stringify(storeLimits)}`);

    // 1. Busca todos os arquivos do Drive e classifica por loja
    const driveByStore = await listDriveFilesByStore();

    // 2. Lança o browser uma única vez para todas as lojas
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-http2'
            ]
        });
    } catch (err) {
        console.error(`❌ [Orchestrator] Falha ao lançar Puppeteer: ${err.message}`);
        return [];
    }

    try {
        // 3. Processa cada loja sequencialmente
        for (const [store, limit] of activeStores) {
            const parser = PARSERS[store];
            const driveFiles = driveByStore[store] || [];

            console.log(`\n🏪 [Orchestrator] Processando: ${store.toUpperCase()} (alvo: ${limit} itens, ${driveFiles.length} no Drive)`);

            if (driveFiles.length === 0) {
                console.log(`📭 [Orchestrator/${store}] Nenhum arquivo no Drive para esta loja.`);
                continue;
            }

            // 4. Aplica filtro de histórico (Tier1: nunca enviado, Tier2: mais antigo)
            const selectionPool = getSelectionPool(driveFiles);
            console.log(`🗂️ [Orchestrator/${store}] Pool disponível: ${selectionPool.length} itens (excluídos enviados hoje)`);

            if (selectionPool.length === 0) {
                console.log(`⚠️ [Orchestrator/${store}] Todos os itens foram enviados hoje. Pulando.`);
                continue;
            }

            // 5. Abre uma página e tenta parsear até atingir o limite
            let successCount = 0;
            let attemptIndex = 0;
            // Tenta no máximo 3x o alvo para ter margem de falhas sem ser lento demais
            const maxAttempts = Math.min(selectionPool.length, limit * 3);

            const page = await browser.newPage();
            try {
                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                );
                await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

                while (successCount < limit && attemptIndex < maxAttempts) {
                    const item = selectionPool[attemptIndex];
                    attemptIndex++;

                    const productId = item.productId || item.fileName;
                    console.log(`   🔍 [${store}] Tentativa ${attemptIndex}/${maxAttempts}: ${productId}`);

                    try {
                        const productData = await parser(page, productId);

                        if (!productData || !productData.nome || !productData.precoAtual) {
                            console.log(`   ⚠️ [${store}] Dados incompletos para ${productId}, pulando.`);
                            continue;
                        }

                        // Gera link de afiliado
                        const affiliateUrl = await generateAwinLink(productData.url, store);
                        productData.url = affiliateUrl;

                        // --- PAYLOAD PADRÃO (Enriquecimento) ---
                        productData.driveId = item.id;
                        productData.fileName = item.fileName;
                        productData.store = store;
                        
                        // Força a imagem do DRIVE no campo imageUrl e image
                        const driveImageUrl = `https://drive.google.com/uc?export=download&id=${item.id}`;
                        productData.imageUrl = driveImageUrl;
                        productData.image = driveImageUrl;

                        // Formata a mensagem padrão conforme a loja
                        if (store === 'renner') {
                            productData.message = formatRennerMessage(productData);
                        } else if (store === 'riachuelo') {
                            productData.message = formatRiachueloMessage(productData);
                        } else if (store === 'cea') {
                            productData.message = formatCeaMessage(productData);
                        }

                        allProducts.push(productData);
                        successCount++;

                        console.log(`   ✅ [${store}] Coletado: "${productData.nome}" (${successCount}/${limit})`);

                    } catch (parseErr) {
                        console.error(`   ❌ [${store}] Erro ao parsear ${productId}: ${parseErr.message}`);
                    }
                }

            } finally {
                await page.close().catch(() => {});
            }

            if (successCount < limit) {
                console.warn(`⚠️ [Orchestrator/${store}] Coletados ${successCount}/${limit} — abaixo do alvo, mas continuando.`);
            } else {
                console.log(`✅ [Orchestrator/${store}] Meta atingida: ${successCount}/${limit}`);
            }
        }

    } finally {
        await browser.close().catch(() => {});
    }

    // Resumo final
    const byStore = {};
    allProducts.forEach(p => { byStore[p.store] = (byStore[p.store] || 0) + 1; });
    console.log(`\n✅ [Orchestrator] Coleta finalizada. Total: ${allProducts.length} produtos.`);
    console.log(`📊 [Orchestrator] Por loja: ${JSON.stringify(byStore)}`);

    return allProducts;
}

module.exports = { runAllScrapers };