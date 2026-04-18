/**
 * Motor de Distribuição de Links
 * Responsável por selecionar os 11 melhores itens de um pool bruto.
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
 * Filtra e organiza os produtos coletados.
 * @param {Array} pool - Lista bruta de produtos vindos dos scrapers.
 * @param {number} limit - Quantidade máxima de itens por post (Padrão: 11).
 */
function distributeLinks(pool, limit = 11) {
    if (!pool || pool.length === 0) return [];

    // 1. Clonar e remover duplicatas (Sanity check)
    let items = [...pool];

    // 2. Ordenação por Categoria (Hierarquia definida em CATEGORY_PRIORITY)
    items.sort((a, b) => {
        const prioA = CATEGORY_PRIORITY[a.categoria] || 99;
        const prioB = CATEGORY_PRIORITY[b.categoria] || 99;
        
        if (prioA !== prioB) {
            return prioA - prioB;
        }
        
        // Se a categoria for a mesma, mantém a ordem original (que costuma ser a do Drive)
        return 0;
    });

    // 3. Aplicação do limite (Batch de 11 itens)
    const selection = items.slice(0, limit);

    console.log(`🎯 [Distributor] Selecionados ${selection.length} itens de um pool de ${pool.length}.`);
    console.log(`📊 Categorias no batch: ${selection.map(i => i.categoria).join(', ')}`);

    return selection;
}

module.exports = { distributeLinks };
