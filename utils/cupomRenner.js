/**
 * utils/cupomRenner.js
 * 
 * Busca e aplica as regras de desconto da tabela `cupom_renner` no Supabase.
 * Deve ser usado APENAS para produtos da loja Renner.
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

/**
 * Busca as regras de cupom válidas da tabela `cupom_renner` no Supabase.
 * Uma regra é válida se:
 *   - `a_partir_de` é numérico e > 0
 *   - `desconto_de` é numérico e está entre 1 e 100
 * @returns {Promise<Array>} Lista de regras válidas, ordenadas por `a_partir_de` decrescente
 */
async function fetchCupomRenner() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'tzmwlmefpkskuogvhksw.supabase.co',
            port: 443,
            path: '/rest/v1/cupom_renner?select=a_partir_de,desconto_de&order=a_partir_de.desc',
            method: 'GET',
            headers: {
                'apikey': SERVICE_KEY,
                'Authorization': 'Bearer ' + SERVICE_KEY,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const rows = JSON.parse(data);
                    if (!Array.isArray(rows)) {
                        console.warn('[CupomRenner] Resposta inesperada do Supabase:', data);
                        return resolve([]);
                    }

                    // Filtra apenas registros válidos
                    const valid = rows.filter(row => {
                        const aPartirDe = parseFloat(row.a_partir_de);
                        const descontoDe = parseFloat(row.desconto_de);
                        return (
                            !isNaN(aPartirDe) && aPartirDe > 0 &&
                            !isNaN(descontoDe) && descontoDe >= 1 && descontoDe <= 100
                        );
                    }).map(row => ({
                        a_partir_de: parseFloat(row.a_partir_de),
                        desconto_de: parseFloat(row.desconto_de)
                    }));

                    // Já vem ordenado DESC por a_partir_de (mais específico primeiro)
                    console.log(`[CupomRenner] ${valid.length} regra(s) válida(s) carregada(s):`, valid);
                    resolve(valid);
                } catch (e) {
                    console.error('[CupomRenner] Erro ao parsear resposta:', e.message);
                    resolve([]);
                }
            });
        });

        req.on('error', (e) => {
            console.error('[CupomRenner] Erro na requisição:', e.message);
            resolve([]);
        });

        req.end();
    });
}

/**
 * Aplica o cupom mais específico compatível com o preço base do produto.
 * 
 * Regra: usa a regra com maior `a_partir_de` que ainda seja <= preço do produto.
 * 
 * @param {number} precoBase - Preço original do produto (capturado no site)
 * @param {Array}  cupomRules - Regras carregadas via fetchCupomRenner()
 * @returns {{ precoOriginal: number, precoAtual: number, descontoAplicado: number|null }}
 */
function applyCupomRenner(precoBase, cupomRules) {
    if (!precoBase || isNaN(precoBase) || !Array.isArray(cupomRules) || cupomRules.length === 0) {
        return { precoOriginal: precoBase, precoAtual: precoBase, descontoAplicado: null };
    }

    // Regras já ordenadas por a_partir_de DESC — pega a primeira compatível
    const regra = cupomRules.find(r => precoBase >= r.a_partir_de);

    if (!regra) {
        // Nenhuma regra se aplica a este preço
        return { precoOriginal: precoBase, precoAtual: precoBase, descontoAplicado: null };
    }

    const valorFinal = precoBase - (precoBase * regra.desconto_de / 100);
    console.log(`[CupomRenner] Desconto de ${regra.desconto_de}% aplicado (a partir de R$${regra.a_partir_de}): R$${precoBase.toFixed(2)} → R$${valorFinal.toFixed(2)}`);

    return {
        precoOriginal: precoBase,     // Preço do site (usado no "De ~X~")
        precoAtual: parseFloat(valorFinal.toFixed(2)),  // Preço com desconto (usado no "por *Y*")
        descontoAplicado: regra.desconto_de
    };
}

module.exports = { fetchCupomRenner, applyCupomRenner };
