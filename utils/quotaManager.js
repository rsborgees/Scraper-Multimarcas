/**
 * utils/quotaManager.js
 *
 * Busca as metas diárias por loja da tabela `quota_config` no Supabase.
 * A cliente edita os valores diretamente no dashboard do Supabase.
 *
 * Retorna { renner: N, cea: N, riachuelo: N }
 * Fallback seguro: valores hardcoded caso o Supabase falhe ou esteja indisponível.
 */

'use strict';

const https = require('https');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

/** Valores padrão caso o Supabase esteja indisponível */
const FALLBACK_TARGETS = {
    renner:    45,
    cea:       10,
    riachuelo: 15
};

/**
 * Busca as metas diárias da tabela `quota_config` no Supabase.
 * Apenas lojas com `ativo = true` são incluídas.
 *
 * @returns {Promise<Object>} Ex: { renner: 45, cea: 10, riachuelo: 15 }
 */
async function loadQuotaTargets() {
    return new Promise((resolve) => {
        if (!SUPABASE_URL || !SERVICE_KEY) {
            console.warn('[QuotaManager] ⚠️  Credenciais Supabase não configuradas. Usando fallback.');
            return resolve({ ...FALLBACK_TARGETS });
        }

        let hostname;
        try {
            hostname = new URL(SUPABASE_URL).hostname;
        } catch {
            console.warn('[QuotaManager] ⚠️  SUPABASE_URL inválida. Usando fallback.');
            return resolve({ ...FALLBACK_TARGETS });
        }

        const options = {
            hostname,
            port: 443,
            path: '/rest/v1/quota_config?select=loja,meta_diaria,ativo&ativo=eq.true',
            method: 'GET',
            headers: {
                'apikey':        SERVICE_KEY,
                'Authorization': 'Bearer ' + SERVICE_KEY,
                'Content-Type':  'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const rows = JSON.parse(data);

                    if (!Array.isArray(rows)) {
                        console.warn('[QuotaManager] ⚠️  Resposta inesperada do Supabase. Usando fallback. Resposta:', data.slice(0, 200));
                        return resolve({ ...FALLBACK_TARGETS });
                    }

                    if (rows.length === 0) {
                        console.warn('[QuotaManager] ⚠️  Tabela quota_config vazia ou todas as lojas estão inativas. Usando fallback.');
                        return resolve({ ...FALLBACK_TARGETS });
                    }

                    const targets = {};
                    rows.forEach(row => {
                        const meta = parseInt(row.meta_diaria, 10);
                        if (row.loja && !isNaN(meta) && meta >= 0) {
                            targets[row.loja] = meta;
                        }
                    });

                    // Fallback por loja individual — garante que lojas ausentes não quebrem o scheduler
                    Object.keys(FALLBACK_TARGETS).forEach(store => {
                        if (!(store in targets)) {
                            console.warn(`[QuotaManager] ⚠️  Loja "${store}" ausente no Supabase. Usando fallback: ${FALLBACK_TARGETS[store]}`);
                            targets[store] = FALLBACK_TARGETS[store];
                        }
                    });

                    console.log('[QuotaManager] ✅ Metas carregadas do Supabase:', targets);
                    resolve(targets);

                } catch (e) {
                    console.error('[QuotaManager] ❌ Erro ao parsear resposta:', e.message);
                    resolve({ ...FALLBACK_TARGETS });
                }
            });
        });

        req.on('error', (e) => {
            console.error('[QuotaManager] ❌ Erro na requisição Supabase:', e.message, '— Usando fallback.');
            resolve({ ...FALLBACK_TARGETS });
        });

        // Timeout de 5s para não travar o scheduler
        req.setTimeout(5000, () => {
            console.warn('[QuotaManager] ⚠️  Timeout ao buscar Supabase. Usando fallback.');
            req.destroy();
            resolve({ ...FALLBACK_TARGETS });
        });

        req.end();
    });
}

module.exports = { loadQuotaTargets, FALLBACK_TARGETS };
