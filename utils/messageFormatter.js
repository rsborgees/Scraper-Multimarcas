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
        if (!val || isNaN(val) || val <= 0) return "R$ --";
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    // Prepara os valores numéricos para comparação
    const valOriginal = product.precoOriginal;
    const valAtual = product.precoAtual;
    const temPromo = valOriginal && valAtual && valOriginal > valAtual;

    const precoOriginalStr = formatCurrency(valOriginal);
    const precoAtualStr = formatCurrency(valAtual);
    
    // Formatação de Tamanhos
    const tamanhosStr = (product.tamanhos && product.tamanhos.length > 0) 
        ? product.tamanhos.join(' ') 
        : "Consultar no site";

    let priceLine = "";
    if (temPromo) {
        priceLine = `De ~${precoOriginalStr}~ por *${precoAtualStr}*`;
    } else if (valAtual && !isNaN(valAtual)) {
        priceLine = `*${precoAtualStr}*`;
    } else if (valOriginal && !isNaN(valOriginal)) {
        priceLine = `*${precoOriginalStr}*`;
    } else {
        priceLine = "*Preço consultar no site*";
    }

    return `*${storeName}*
${invisibleChar}
🏷️ Cupom ${cupom}
(ativo clicando pelos meus links) 
${invisibleChar}

${product.nome}
${tamanhosStr}
${priceLine}

🔗 ${product.url}

Vagas para nossa Comunidade: 
(chama as amigas) 👇🏼

${communityLink}`;
}

module.exports = { formatRennerMessage };
