/**
 * Utilitário para formatação de mensagens de produtos (WhatsApp/Telegram)
 */

function formatRennerMessage(product) {
    const storeName = "RENNER";
    const invisibleChar = "ㅤ"; // U+3164 solicitado pelo usuário
    const cupom = "*FRANCALHEIRA*";
    const communityLink = "https://chat.whatsapp.com/BvwDGxSyny67OV0loLpS9p";

    // Formatação de Preços
    const formatCurrency = (val) => {
        if (!val || isNaN(val)) return "R$ --";
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const precoOriginal = formatCurrency(product.precoOriginal);
    const precoAtual = formatCurrency(product.precoAtual);
    
    // Formatação de Tamanhos
    const tamanhosStr = (product.tamanhos && product.tamanhos.length > 0) 
        ? product.tamanhos.join(' ') 
        : "Consultar no site";

    const priceLine = (product.precoOriginal && product.precoOriginal > product.precoAtual)
        ? `De ~${precoOriginal}~ por *${precoAtual}*`
        : `por *${precoAtual}*`;

    return `*${storeName}*
${invisibleChar}
🏷️ Cupom ${cupom}
(ativo clicando pelos meus links) 

${product.nome}
${tamanhosStr}
${priceLine}

🔗 ${product.url}

Vagas para nossa Comunidade: 
(chama as amigas) 👇🏼

${communityLink}`;
}

module.exports = { formatRennerMessage };
