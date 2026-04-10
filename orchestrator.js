const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getSelectionPool } = require('./utils/historyManager');
const { parseProductRenner } = require('./renner/parser');
const { parseProductCEA } = require('./cea/parser');
const { parseProductRiachuelo } = require('./riachuelo/parser');
const { generateAwinLink } = require('./utils/affiliateManager');

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
                
                // Sobrescrever imageUrl com o link do Drive se disponível
                if (item.driveFileId) {
                    data.imageUrl = `https://drive.google.com/uc?export=download&id=${item.driveFileId}`;
                }
                
                rawResults.push({ ...data, store, driveId: item.id });
                console.log(`✅ [${store.toUpperCase()}] Sucesso: ${item.id} | Imagem: ${data.imageUrl ? 'Drive ✅' : 'Null ❌'}`);
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
            const items = [];
            
            // Estratégia 1: Procurar por elementos que tenham data-id (comum no Drive)
            const rows = document.querySelectorAll('div[data-id]');
            rows.forEach(row => {
                const text = row.innerText || '';
                const match = text.match(/\d{6,}/);
                const fileId = row.getAttribute('data-id');
                if (match && fileId && fileId.length > 20) {
                     items.push({ 
                         id: match[0], 
                         driveFileId: fileId,
                         fileName: text.split('\n')[0].substring(0, 100).toLowerCase() 
                     });
                }
            });

            // Estratégia 2: Se falhar a 1, procurar por links de arquivos
            if (items.length === 0) {
                const links = document.querySelectorAll('a[href*="/file/d/"]');
                links.forEach(link => {
                    const href = link.href;
                    const idMatch = href.match(/\/file\/d\/([^/]+)/);
                    const container = link.closest('div[role="row"], div[jslog]') || link;
                    const text = container.innerText || link.innerText || '';
                    const numMatch = text.match(/\d{6,}/);
                    
                    if (idMatch && numMatch) {
                        items.push({
                            id: numMatch[0],
                            driveFileId: idMatch[1],
                            fileName: text.split('\n')[0].trim().toLowerCase()
                        });
                    }
                });
            }

            // Estratégia 3: Fallback original (apenas texto) se nada acima funcionar
            if (items.length === 0) {
                const elements = document.querySelectorAll('div, a, span');
                elements.forEach(el => {
                    const text = (el.innerText || el.textContent || '').trim();
                    const match = text.match(/\d{6,}/);
                    if (match && text.length < 200) {
                        items.push({ id: match[0], fileName: text.split('\n')[0].substring(0, 100).toLowerCase() });
                    }
                });
            }

            // Remover duplicatas por SKU (id)
            const unique = [];
            const map = new Map();
            for (const item of items) {
                if (!map.has(item.id)) {
                    map.set(item.id, true);
                    unique.push(item);
                }
            }
            return unique;
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
