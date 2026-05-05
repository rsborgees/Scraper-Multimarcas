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
const { NOVIDADE_KEYS } = require('./utils/quotaManager');

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
 * Cada item: { id, fileName, productId, store, isNovidade }
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

        // Detecta se é novidade pelo nome do arquivo
        const isNovidade = nameLower.includes('novidade');

        // O que sobrou (removendo espaços extras) é o ID completo
        const productId = cleanName.trim();

        // Só processa se sobrar algo que pareça um ID (pelo menos 4 caracteres)
        if (productId.length < 4) return;

        byStore[store].push({ id: f.id, fileName: f.name, productId, store, isNovidade });
    });

    Object.entries(byStore).forEach(([store, items]) => {
        const novCount = items.filter(i => i.isNovidade).length;
        console.log(`   📁 ${store}: ${items.length} arquivos (${novCount} novidades)`);
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
 * @param {Object} storeLimits - Ex: { renner: 3, novidades_renner: 1, riachuelo: 1, cea: 0 }
 * @returns {Promise<Array>} - Pool bruto de produtos parseados
 */
async function runAllScrapers(storeLimits = {}) {
    const allProducts = [];

    // Filtra lojas ativas (limit > 0) com parser disponível (ignora chaves de novidades aqui)
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

            // Calcula sub-limites: total = normais + novidades
            const novidadeKey = NOVIDADE_KEYS[store];
            const novidadeLimit = (novidadeKey && storeLimits[novidadeKey] > 0)
                ? storeLimits[novidadeKey]
                : 0;
            const normalLimit = limit - novidadeLimit;

            console.log(`\n🏪 [Orchestrator] Processando: ${store.toUpperCase()} (alvo: ${limit} = ${normalLimit} normais + ${novidadeLimit} novidades | ${driveFiles.length} no Drive)`);

            if (driveFiles.length === 0) {
                console.log(`📭 [Orchestrator/${store}] Nenhum arquivo no Drive para esta loja.`);
                continue;
            }

            // Separa o pool do Drive em dois sub-pools
            const driveNovidades = driveFiles.filter(f => f.isNovidade);
            const driveNormais   = driveFiles.filter(f => !f.isNovidade);
            console.log(`🗂️ [Orchestrator/${store}] Drive split: ${driveNormais.length} normais, ${driveNovidades.length} novidades`);

            // 4. Abre uma única página para esta loja (reutilizada por normais e novidades)
            const page = await browser.newPage();
            try {
                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                );
                await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

                /**
                 * Sub-função de coleta: processa um pool (normais OU novidades)
                 * até atingir targetCount sucessos.
                 */
                async function collectFromPool(pool, targetCount, isNovidade) {
                    if (targetCount <= 0) return;

                    const selPool = getSelectionPool(pool);
                    const label = isNovidade ? 'novidades' : 'normais';
                    console.log(`   📋 [${store}/${label}] Pool disponível: ${selPool.length} (excluídos enviados hoje). Alvo: ${targetCount}`);

                    if (selPool.length === 0) {
                        console.log(`   ⚠️ [${store}/${label}] Pool vazio. Pulando.`);
                        return;
                    }

                    let successCount = 0;
                    let attemptIndex = 0;
                    const maxAttempts = Math.min(selPool.length, Math.max(targetCount * 20, 50));

                    while (successCount < targetCount && attemptIndex < maxAttempts) {
                        const item = selPool[attemptIndex];
                        attemptIndex++;

                        const rawProductId = item.productId || item.fileName;

                        // --- Lógica de Conjuntos (Parsing de IDs e Tamanhos) ---
                        const tokens = rawProductId.split(/[\s_]+/);
                        const targets = [];
                        for (let i = 0; i < tokens.length; i++) {
                            const token = tokens[i];
                            // IDs geralmente têm 7+ dígitos. C&A pode ter 5+.
                            if (token.length >= 7 || (store === 'cea' && token.length >= 5)) {
                                const nextToken = tokens[i + 1];
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
                            console.log(`   ⚠️ [${store}] Nenhum ID válido em "${rawProductId}", pulando.`);
                            continue;
                        }

                        const targetsDesc = targets.map(t => `${t.id}${t.sizeUsed ? ` (${t.sizeUsed})` : ''}`).join(', ');
                        console.log(`   🔍 [${store}/${label}] Tentativa ${attemptIndex}/${maxAttempts}: ${targetsDesc}`);

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
                                    p.searchId = target.id;

                                    // --- Filtro de Match de ID (Riachuelo) ---
                                    if (store === 'riachuelo') {
                                        let driveId = String(target.id);
                                        let driveBaseId = (driveId.length === 10 && driveId.endsWith('00')) ? driveId.substring(0, 8) : driveId;
                                        const pageIds = p.allSkuIds || [String(p.id)];
                                        
                                        const hasMatch = pageIds.some(pid => 
                                            pid === driveId || 
                                            pid === driveBaseId || 
                                            String(pid).startsWith(driveBaseId) ||
                                            driveBaseId.startsWith(String(pid))
                                        );

                                        if (!hasMatch) {
                                            console.log(`   ⚠️ [Riachuelo] Bloqueado: ID do Drive ${driveId} não encontrado na página (Página: ${p.id}).`);
                                            continue;
                                        }
                                    }

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
                                p.novidade = isNovidade; // 🆕 Flag de novidade

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
                            result.novidade = isNovidade; // 🆕 Flag de novidade no resultado

                            // Formatação da Mensagem
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
                            console.log(`   ✅ [${store}/${label}] Coletado: ${msgDesc} (${successCount}/${targetCount})`);

                        } catch (parseErr) {
                            console.error(`   ❌ [${store}] Erro ao processar ${rawProductId}: ${parseErr.message}`);
                        }
                    }

                    if (successCount < targetCount) {
                        console.warn(`⚠️ [Orchestrator/${store}] ${label}: ${successCount}/${targetCount} — abaixo do alvo, mas continuando.`);
                    } else {
                        console.log(`✅ [Orchestrator/${store}] ${label}: meta atingida ${successCount}/${targetCount}`);
                    }
                }

                // Coleta novidades primeiro, depois normais
                await collectFromPool(driveNovidades, novidadeLimit, true);
                await collectFromPool(driveNormais, normalLimit, false);

            } finally {
                await page.close().catch(() => {});
            }
        }

    } finally {
        await browser.close().catch(() => {});
    }

    // Resumo final
    const byStore = {};
    allProducts.forEach(p => { byStore[p.store] = (byStore[p.store] || 0) + 1; });
    const novidadesCount = allProducts.filter(p => p.novidade).length;
    console.log(`\n✅ [Orchestrator] Coleta finalizada. Total: ${allProducts.length} produtos (${novidadesCount} novidades).`);
    console.log(`📊 [Orchestrator] Por loja: ${JSON.stringify(byStore)}`);

    return allProducts;
}

module.exports = { runAllScrapers };