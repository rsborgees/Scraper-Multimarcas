const axios = require('axios');
require('dotenv').config();

const { runAllScrapers } = require('./orchestrator');
const { distributeLinks } = require('./utils/linkDistributor');
const { loadHistory, markAsSent } = require('./utils/historyManager');

/**
 * CONFIGURAÇÕES DE METAS (Copiadas do cronScheduler para manter paridade)
 */
const IDEAL_TARGETS = {
    'renner': 45,
    'cea': 10,
    'riachuelo': 15
};

const BATCH_CONFIG = {
    'renner': { min: 3, max: 3 },
    'riachuelo': { min: 1, max: 1 },
    'cea': { min: 1, max: 1 }
};

function calculateDynamicQuotas() {
    const history = loadHistory();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    
    const counts = {};
    Object.values(history).forEach(entry => {
        if (entry.lastSent && entry.lastSent.startsWith(today)) {
            counts[entry.store] = (counts[entry.store] || 0) + 1;
        }
    });

    const quotas = {};
    Object.keys(IDEAL_TARGETS).forEach(store => {
        const sent = counts[store] || 0;
        const target = IDEAL_TARGETS[store];
        quotas[store] = Math.max(0, target - sent);
    });

    return { quotas, counts };
}

function calculateHourlyBatchLimit(quotas) {
    const now = new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"});
    const currentHour = new Date(now).getHours();
    const endHour = 21;
    const hoursRemaining = Math.max(1, endHour - currentHour + 1);

    const hourlyLimits = {};
    let totalBatchSize = 0;

    Object.keys(quotas).forEach(store => {
        if (quotas[store] <= 0) {
            hourlyLimits[store] = 0;
            return;
        }
        const config = BATCH_CONFIG[store] || { min: 1, max: 3 };
        const calculated = Math.ceil(quotas[store] / hoursRemaining);
        let limit = Math.max(config.min, calculated);
        limit = Math.min(limit, config.max);
        limit = Math.min(quotas[store], limit);
        
        hourlyLimits[store] = limit;
        totalBatchSize += limit;
    });

    return { hourlyLimits, totalBatchSize };
}

async function sendBatchToWebhook(items) {
    const url = process.env.WEBHOOK_URL;
    if (!url) return;
    try {
        console.log(`📡 [Webhook] Enviando batch de ${items.length} itens...`);
        const response = await axios.post(url, items);
        if (response.status === 200) {
            console.log('✅ [Webhook] Recebido com sucesso pelo n8n.');
        }
    } catch (error) {
        console.error('❌ [Webhook] Falha no envio:', error.message);
    }
}

async function runManualCycle() {
    console.log(`\n🚀 [Manual Run] Iniciando ciclo completo do agendador...`);
    
    try {
        const { quotas, counts } = calculateDynamicQuotas();
        const { hourlyLimits, totalBatchSize } = calculateHourlyBatchLimit(quotas);
        
        console.log('📊 Status atual de hoje:', counts);
        console.log('🎯 GAPs (quanto falta):', quotas);
        console.log('⚖️ Limites calculados para este disparo:', hourlyLimits);

        if (totalBatchSize === 0) {
            console.log('✅ Metas diárias já atingidas para todas as lojas. Nada para fazer.');
            return;
        }

        const rawPool = await runAllScrapers(hourlyLimits);
        const finalSelection = distributeLinks(rawPool, hourlyLimits);

        if (finalSelection.length > 0) {
            await sendBatchToWebhook(finalSelection);
            
            finalSelection.forEach(item => {
                markAsSent(item.driveId || item.id, item.store);
            });
            
            console.log(`✅ Ciclo finalizado: ${finalSelection.length} itens enviados.`);
        } else {
            console.log('📭 Nenhum item válido encontrado nesta rodada.');
        }

    } catch (error) {
        console.error('❌ Erro no ciclo manual:', error.message);
    }
}

runManualCycle();
