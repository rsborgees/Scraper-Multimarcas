/**
 * Motor de Distribuição de Links
 * Responsável por selecionar os melhores itens de um pool bruto,
 * respeitando os limites por loja definidos pelo Scheduler.
 */

const CATEGORY_PRIORITY = {
    'vestido': 1,
    'macacão': 2,
    'saia': 3,
    'calça': 4,
    'short': 5,
    'blusa': 6,
    'casaco': 7,
    'acessório': 8,
    'outros': 9
};

/**
 * Filtra e organiza os produtos coletados respeitando a proporção por loja.
 * @param {Array} pool - Lista bruta de produtos vindos dos scrapers.
 * @param {number|Object} limitOrStoreLimits - Número total (legado) OU
 *        objeto { renner: N, riachuelo: N, cea: N } com limites por loja.
 */
function distributeLinks(pool, limitOrStoreLimits = 11) {
    if (!pool || pool.length === 0) return [];

    // Ordenação por Categoria (Hierarquia definida em CATEGORY_PRIORITY)
    const sorted = [...pool].sort((a, b) => {
        const prioA = CATEGORY_PRIORITY[a.categoria] || 99;
        const prioB = CATEGORY_PRIORITY[b.categoria] || 99;
        return prioA !== prioB ? prioA - prioB : 0;
    });

    let selection;

    if (typeof limitOrStoreLimits === 'object' && limitOrStoreLimits !== null) {
        // Modo com limites por loja — garante a proporção correta
        const storeLimits = limitOrStoreLimits;
        const storeCounts = {};
        selection = [];

        for (const item of sorted) {
            const store = item.store;
            const limit = storeLimits[store] || 0;
            const count = storeCounts[store] || 0;

            if (count < limit) {
                selection.push(item);
                storeCounts[store] = count + 1;
            }

            // Para quando todos os limites forem atingidos
            const totalTarget = Object.values(storeLimits).reduce((a, b) => a + b, 0);
            if (selection.length >= totalTarget) break;
        }

        console.log(`🎯 [Distributor] Selecionados ${selection.length} itens de um pool de ${pool.length}.`);
        console.log(`📊 Distribuição por loja: ${JSON.stringify(storeCounts)} | Alvo: ${JSON.stringify(storeLimits)}`);
    } else {
        // Modo legado — corta pelo limite numérico total
        selection = sorted.slice(0, limitOrStoreLimits);
        console.log(`🎯 [Distributor] Selecionados ${selection.length} itens de um pool de ${pool.length}.`);
        console.log(`📊 Categorias no batch: ${selection.map(i => i.categoria).join(', ')}`);
    }

    return selection;
}

module.exports = { distributeLinks };
