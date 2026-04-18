/**
 * Utilitário para formatação de mensagens de produtos (WhatsApp/Telegram)
 */

function formatRennerMessage(product) {
    const storeName = "RENNER";
    const invisibleChar = "ㅤ";
    const cupom = "*FRANCALHEIRA*";
    
    // Formatação de Preços
    const formatCurrency = (val) => {
        if (!val || isNaN(val) || val <= 0) return "R$ --";
        // Formato: R$ 199,90
        return val.toLocaleString('pt-BR', { 
            style: 'currency', 
            currency: 'BRL' 
        });
    };

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
    } else {
        priceLine = `Por *${precoAtualStr}*`;
    }

    // Construção da Mensagem
    let message = `*${storeName}*
${invisibleChar}
🏷️ Cupom ${cupom}
(ativo clicando pelos meus links)
${invisibleChar}

${product.nome}`;

    // Adiciona "Tamanho que usei" se existir (vindo do Drive)
    if (product.tamanhoQueUsei) {
        message += `\n\nTamanho que usei: ${product.tamanhoQueUsei}`;
    }

    message += `\n\n${tamanhosStr}
${priceLine}

🔗 ${product.url}`;

    return message;
}

module.exports = { formatRennerMessage };
