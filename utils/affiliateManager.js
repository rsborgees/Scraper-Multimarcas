/**
 * Gerenciador de links de afiliados Awin
 * Realiza a parametrização e o encurtamento (tidd.ly) via API.
 */

const MERCHANT_IDS = {
    'renner': '70694',
    'riachuelo': '86587',
    'cea': 'cea-minha' // Marcador para identificar que usa lógica própria
};

const PUBLISHER_IDS = {
    'riachuelo': process.env.AWIN_PUBLISHER_ID_RIACHUELO
};

/**
 * Gera um link parametrizado para o produto.
 * 
 * @param {string} originalUrl - A URL original do produto
 * @param {string} store - O nome da loja (ex: 'renner')
 * @returns {Promise<string>} - A URL parametrizada
 */
async function generateAffiliateLink(originalUrl, store) {
    const storeLower = store.toLowerCase();
    
    // Lógica específica para C&A (Minha C&A via UTMs)
    if (storeLower === 'cea' || storeLower === 'c&a') {
        const consultantId = process.env.MINHA_CEA_ID || 'franindica';
        const cleanUrl = originalUrl.split('?')[0];
        // Estrutura padrão Minha C&A: utm_source=mais&utm_medium=minhacea&utm_campaign=ID
        return `${cleanUrl}?utm_source=mais&utm_medium=minhacea&utm_campaign=${consultantId}`;
    }

    // Lógica Awin para Renner e Riachuelo
    if (!MERCHANT_IDS[storeLower]) {
        console.log(`ℹ️ [Affiliate] Ignorando parametrização para ${store} (Loja não configurada).`);
        return originalUrl;
    }

    const publisherId = PUBLISHER_IDS[storeLower] || process.env.AWIN_PUBLISHER_ID;
    const advertiserId = MERCHANT_IDS[storeLower];

    if (!publisherId) {
        console.warn('⚠️ [Awin] AWIN_PUBLISHER_ID não configurado.');
        return originalUrl;
    }

    const cleanUrl = originalUrl.split('?')[0];
    const longTrackingUrl = `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${publisherId}&ued=${encodeURIComponent(cleanUrl)}`;

    console.log(`🔗 [Awin] Parametrizando link para ${store.toUpperCase()}...`);
    return longTrackingUrl;
}

module.exports = {
    generateAwinLink: generateAffiliateLink, // Mantendo compatibilidade com o nome antigo no resto do código
    generateAffiliateLink,
    MERCHANT_IDS
};
