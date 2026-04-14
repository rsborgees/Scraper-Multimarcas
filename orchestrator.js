const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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
        console.log('📂 [PHASE 1] Iniciando prioridade do Google Drive...');
        const driveItems = await fetchDriveItems(page);
        const pool = getSelectionPool(driveItems);

        // Se o scheduler passou quotas, respeitamos. Senão, usamos o pool completo até o limite.
        const limit = quotas ? Object.values(quotas).reduce((a, b) => a + b, 0) : (parseInt(process.env.DAILY_QUOTA) || 10);
        const itemsToProcess = pool.slice(0, limit);

        for (const item of itemsToProcess) {
            const store = detectStore(item.fileName);
            const parser = getParser(store);

            if (!parser) continue;

            console.log(`🕵️ [${store.toUpperCase()}] Processando: ${item.id}`);
            const data = await parser(page, item.id);
            
            if (data) {
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

async function fetchDriveItems(page) {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    try {
        await page.goto(`https://drive.google.com/drive/folders/${folderId}`, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        return await page.evaluate(() => {
            const resultsMap = new Map();
            
            const addItem = (id, driveFileId, fileName) => {
                const existing = resultsMap.get(id);
                resultsMap.set(id, {
                    id,
                    driveFileId: driveFileId || (existing ? existing.driveFileId : null),
                    fileName: fileName || (existing ? existing.fileName : '')
                });
            };

            // Estratégia 1: data-id (Containers de arquivos)
            document.querySelectorAll('div[data-id]').forEach(el => {
                const driveId = el.getAttribute('data-id');
                const text = el.innerText || '';
                const skuMatch = text.match(/\d{6,}/);
                if (skuMatch && driveId && driveId.length > 20) {
                    addItem(skuMatch[0], driveId, text.split('\n')[0].substring(0, 100).toLowerCase());
                }
            });

            // Estratégia 2: Links diretos (/file/d/)
            document.querySelectorAll('a[href*="/file/d/"]').forEach(link => {
                const idMatch = link.href.match(/\/file\/d\/([^/]+)/);
                const container = link.closest('div[role="row"], div[jslog]') || link;
                const text = container.innerText || link.innerText || '';
                const skuMatch = text.match(/\d{6,}/);
                if (idMatch && skuMatch) {
                    addItem(skuMatch[0], idMatch[1], text.split('\n')[0].trim().toLowerCase());
                }
            });

            // Estratégia 3: Texto puro (Fallback para mapear SKUs mesmo sem ID de arquivo)
            document.querySelectorAll('div, a, span').forEach(el => {
                if (el.children.length > 0) return; // Apenas folhas para evitar duplicação de texto longo
                const text = el.innerText || '';
                const skuMatch = text.match(/\d{6,}/);
                if (skuMatch && text.length < 150) {
                    addItem(skuMatch[0], null, text.split('\n')[0].toLowerCase());
                }
            });

            return Array.from(resultsMap.values());
        });
    } catch (e) {
        console.error('❌ Erro no Drive:', e.message);
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
