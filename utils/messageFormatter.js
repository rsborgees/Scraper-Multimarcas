/**
 * Utilitário para formatação de mensagens de produtos (WhatsApp/Telegram)
 */

function formatRennerMessage(productOrProducts) {
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

    const buildProductBlock = (product) => {
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

        let block = `${product.nome}`;
        
        if (product.tamanhoQueUsei) {
            block += `\n\nTamanho que usei: ${product.tamanhoQueUsei}`;
        }
        
        block += `\n\n${tamanhosStr}\n${priceLine}\n\n🔗 ${product.url}`;
        
        return block;
    };

    // Construção da Mensagem
    let message = `*${storeName}*
${invisibleChar}
🏷️ Cupom ${cupom}
(ativo clicando pelos meus links)
${invisibleChar}
`;

    if (Array.isArray(productOrProducts)) {
        const blocks = productOrProducts.map(p => buildProductBlock(p));
        // Separa cada peça por quebras de linha generosas
        message += "\n" + blocks.join('\n\n\n');
    } else {
        message += "\n" + buildProductBlock(productOrProducts);
    }

    return message;
}

function formatRiachueloMessage(productOrProducts) {
    const storeName = "RIACHUELO";
    const invisibleChar = "ㅤ";
    const cupom = "*FRANCALHEIRA*";
    
    // Formatação de Preços
    const formatCurrency = (val) => {
        if (!val || isNaN(val) || val <= 0) return "R$ --";
        return val.toLocaleString('pt-BR', { 
            style: 'currency', 
            currency: 'BRL' 
        });
    };

    const buildProductBlock = (product) => {
        const valOriginal = product.precoOriginal;
        const valAtual = product.precoAtual;
        const temPromo = valOriginal && valAtual && valOriginal > valAtual;

        const precoOriginalStr = formatCurrency(valOriginal);
        const precoAtualStr = formatCurrency(valAtual);
        
        const tamanhosStr = (product.tamanhos && product.tamanhos.length > 0) 
            ? product.tamanhos.join(' ') 
            : "Consultar no site";

        let priceLine = "";
        if (temPromo) {
            priceLine = `De ~${precoOriginalStr}~ por *${precoAtualStr}*`;
        } else {
            priceLine = `Por *${precoAtualStr}*`;
        }

        let block = `${product.nome}`;
        
        if (product.tamanhoQueUsei) {
            block += `\n\nTamanho que usei: ${product.tamanhoQueUsei}`;
        }
        
        block += `\n\n${tamanhosStr}\n${priceLine}\n\n🔗 ${product.url}`;
        
        return block;
    };

    let message = `*${storeName}*
${invisibleChar}
🏷️ Cupom ${cupom}
(ativo clicando pelos meus links)
${invisibleChar}
`;

    if (Array.isArray(productOrProducts)) {
        const blocks = productOrProducts.map(p => buildProductBlock(p));
        message += "\n" + blocks.join('\n\n\n');
    } else {
        message += "\n" + buildProductBlock(productOrProducts);
    }

    return message;
}

function formatCeaMessage(productOrProducts) {
    const storeName = "C&A";
    const invisibleChar = "ㅤ";
    
    const formatCurrency = (val) => {
        if (!val || isNaN(val) || val <= 0) return "R$ --";
        return val.toLocaleString('pt-BR', { 
            style: 'currency', 
            currency: 'BRL' 
        });
    };

    const buildProductBlock = (product) => {
        const valOriginal = product.precoOriginal;
        const valAtual = product.precoAtual;
        const temPromo = valOriginal && valAtual && valOriginal > valAtual;

        const precoOriginalStr = formatCurrency(valOriginal);
        const precoAtualStr = formatCurrency(valAtual);
        
        const tamanhosStr = (product.tamanhos && product.tamanhos.length > 0) 
            ? product.tamanhos.join(' ') 
            : "Consultar no site";

        let priceLine = "";
        if (temPromo) {
            priceLine = `De ~${precoOriginalStr}~ por *${precoAtualStr}*`;
        } else {
            priceLine = `Por *${precoAtualStr}*`;
        }

        let block = `${product.nome}`;
        
        if (product.tamanhoQueUsei) {
            block += `\n\nTamanho que usei: ${product.tamanhoQueUsei}`;
        }
        
        block += `\n\n${tamanhosStr}\n${priceLine}\n\n🔗 ${product.url}`;
        
        return block;
    };

    let message = `*${storeName}*
${invisibleChar}
🏷️ Cupom automático clicando pelos meus links
${invisibleChar}
`;

    if (Array.isArray(productOrProducts)) {
        const blocks = productOrProducts.map(p => buildProductBlock(p));
        message += "\n" + blocks.join('\n\n\n');
    } else {
        message += "\n" + buildProductBlock(productOrProducts);
    }

    return message;
}

module.exports = { formatRennerMessage, formatRiachueloMessage, formatCeaMessage };
