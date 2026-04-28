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
            headless: process.env.HEADLESS === 'false' ? false : true,
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
            // Tenta no máximo 10x o alvo para ter margem de falhas maior (pedido pelo usuário)
            const maxAttempts = Math.min(selectionPool.length, limit * 10);

            const page = await browser.newPage();
            try {
                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                );
                await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

                while (successCount < limit && attemptIndex < maxAttempts) {
                    const item = selectionPool[attemptIndex];
                    attemptIndex++;

                    const rawProductId = item.productId || item.fileName;
                    
                    // --- Lógica de Conjuntos (Parsing de IDs e Tamanhos) ---
                    // Ex: "930773780 38 931151771" -> IDs: [930773780 (tam 38), 931151771 (sem tam)]
                    const tokens = rawProductId.split(/\s+/);
                    const targets = [];
                    for (let i = 0; i < tokens.length; i++) {
                        const token = tokens[i];
                        // IDs geralmente têm 7+ dígitos. C&A pode ter 5+.
                        if (token.length >= 7 || (store === 'cea' && token.length >= 5)) {
                            const nextToken = tokens[i+1];
                            let sizeUsed = null;
                            // Se o próximo token parece um tamanho (ex: 38, PP, G)
                            if (nextToken && /^(PP|P|M|G|GG|G1|G2|G3|G4|XG|XGG|UNI|U|\d{2})$/i.test(nextToken)) {
                                sizeUsed = nextToken.toUpperCase();
                                i++; // Consome o token de tamanho
                            }
                            targets.push({ id: token, sizeUsed });
                        }
                    }

                    if (targets.length === 0) {
                        console.log(`   ⚠️ [${store}] Nenhum ID válido encontrado em "${rawProductId}", pulando.`);
                        continue;
                    }

                    const targetsDesc = targets.map(t => `${t.id}${t.sizeUsed ? ` (${t.sizeUsed})` : ''}`).join(', ');
                    console.log(`   🔍 [${store}] Tentativa ${attemptIndex}/${maxAttempts}: ${targetsDesc}`);

                    try {
                        const scrapedProducts = [];
                        for (const target of targets) {
                            const p = await parser(page, target.id);
                            if (p && p.nome && p.precoAtual) {
                                // --- Filtro de Tamanhos Restritos (PP/GG sozinhos) ---
                                const availableSizes = p.tamanhos || [];
                                if (availableSizes.length === 1) {
                                    const s = availableSizes[0].toUpperCase();
                                    if (s === 'PP' || s === 'GG') {
                                        console.log(`   ⚠️ [${store}] Bloqueado: Apenas ${s} disponível para ${target.id}`);
                                        continue;
                                    }
                                }
                                
                                p.tamanhoQueUsei = target.sizeUsed;
                                scrapedProducts.push(p);
                            }
                        }

                        if (scrapedProducts.length === 0) {
                            console.log(`   ⚠️ [${store}] Falha ao coletar dados para ${rawProductId}, pulando.`);
                            continue;
                        }

                        // Enriquecimento de cada produto do conjunto
                        for (const p of scrapedProducts) {
                            const affiliateUrl = await generateAwinLink(p.url, store);
                            p.url = affiliateUrl;
                            p.store = store;
                            
                            // Imagem do DRIVE (comum a todos do arquivo)
                            const driveImageUrl = `https://drive.google.com/uc?export=download&id=${item.id}`;
                            p.imageUrl = driveImageUrl;
                            p.image = driveImageUrl;
                        }

                        // Define o objeto de resultado
                        let result;
                        if (scrapedProducts.length > 1) {
                            // É um conjunto. Usamos o primeiro como base para campos globais.
                            result = { ...scrapedProducts[0] };
                            result.isConjunto = true;
                            result.subProducts = scrapedProducts;
                        } else {
                            result = scrapedProducts[0];
                        }

                        // Metadados do Drive
                        result.driveId = item.id;
                        result.fileName = item.fileName;

                        // Formatação da Mensagem (Passa array para o formatter se for conjunto)
                        const formatterInput = scrapedProducts.length > 1 ? scrapedProducts : result;
                        if (store === 'renner') {
                            result.message = formatRennerMessage(formatterInput);
                        } else if (store === 'riachuelo') {
                            result.message = formatRiachueloMessage(formatterInput);
                        } else if (store === 'cea') {
                            result.message = formatCeaMessage(formatterInput);
                        }

                        allProducts.push(result);
                        successCount++;

                        const msgDesc = scrapedProducts.length > 1 ? `${scrapedProducts.length} itens (conjunto)` : `"${result.nome}"`;
                        console.log(`   ✅ [${store}] Coletado: ${msgDesc} (${successCount}/${limit})`);

                    } catch (parseErr) {
                        console.error(`   ❌ [${store}] Erro ao processar ${rawProductId}: ${parseErr.message}`);
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