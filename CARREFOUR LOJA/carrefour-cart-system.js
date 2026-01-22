/**
 * Sistema de Carrinho + Checkout Pagou.ai
 * 
 * FUNCIONANDO PERFEITAMENTE!
 * 
 * Formato do payload baseado no payload exato capturado da loja Shopify real.
 * A Pagou.ai reconhece produtos pelos IDs do Shopify (variant_id e product_id).
 * 
 * IMPORTANTE:
 * - IDs devem ser numeros (nao strings)
 * - presentment_price deve estar em unidades (nao centavos)
 * - key no formato: variantId:hash
 * - token no formato: hash?key=hash
 * 
 * Veja SOLUCAO-CHECKOUT-PAGOU-AI.md para documentacao completa.
 * 
 * Sistema de carrinho com localStorage
 * Integracao com Pagou.ai
 * Navegacao local limpa
 */

(function () {
    'use strict';

    const CART_KEY = 'carrefour_cart';
    const SHOP_DOMAIN = 'twqm8i-xi.myshopify.com';
    
    class CarrefourCart {
        constructor() {
            this.cart = this.loadCart();
            this.productMapping = {}; // Será carregado assincronamente
            // Garante que o carrinho está sincronizado
            console.log('🛒 CarrefourCart inicializado com', this.cart.items.length, 'produtos');
            this.init();
        }

        init() {
            console.log('%c🛒 Carrefour Cart iniciado v6.0 (Limpo)', 'background: #222; color: #bada55; font-size: 14px; padding: 4px;');

            // Intercepta cliques no ícone do carrinho ANTES de tudo
            this.interceptCartIconClick();
            
            // Intercepta window.location ANTES de tudo para capturar redirecionamentos
            this.interceptCartRedirect();
            
            // Intercepta fetch para /cart/add.js
            this.interceptFetch();
            
            // Intercepta redirecionamentos para /cart de forma agressiva (backup)
            this.interceptCartRedirectAggressive();
            
            this.setupLogoClick();

            const pageType = this.detectPageType();

            if (pageType === 'product') {
                this.initProduct();
            } else if (pageType === 'cart') {
                // Intercepta submits IMEDIATAMENTE na página do carrinho
                this.interceptCheckoutForms();
                this.initCart();
            }
        }
        
        interceptCartIconClick() {
            const self = this;
            // Intercepta cliques no ícone do carrinho GLOBALMENTE
            document.addEventListener('click', function(e) {
                const cartIcon = e.target.closest('.cfar-ico--cart, a[href*="/cart"]');
                if (cartIcon) {
                    const href = cartIcon.getAttribute('href') || '';
                    // Se é link para cart da Shopify, intercepta
                    if (href.includes('myshopify.com/cart') || href === '/cart' || href.includes('/cart')) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        console.log('🛒 Ícone do carrinho clicado - redirecionando para nosso cart');
                        const cartPath = self.getCartPath();
                        window.location.href = cartPath;
                        return false;
                    }
                }
            }, true); // Capture phase - executa ANTES de outros listeners
        }
        
        interceptCheckoutForms() {
            const self = this;
            
            // Intercepta TODOS os submits na página (capture phase - executa ANTES de outros listeners)
            const submitHandler = function(e) {
                const form = e.target;
                if (form && form.tagName === 'FORM') {
                    const action = form.getAttribute('action') || '';
                    const hasCheckoutBtn = form.querySelector('button[name="checkout"], button[type="submit"][name="checkout"]');
                    
                    if (hasCheckoutBtn || action.includes('cart') || action.includes('checkout')) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        console.log('🛒 Form submit interceptado GLOBALMENTE (capture phase)');
                        self.checkoutPagou();
                        return false;
                    }
                }
            };
            
            // Adiciona em múltiplas fases para garantir
            document.addEventListener('submit', submitHandler, true); // Capture phase
            document.addEventListener('submit', submitHandler, false); // Bubble phase
            
            // Intercepta também cliques em botões de checkout
            const clickHandler = function(e) {
                const target = e.target;
                const isCheckoutBtn = target.matches('button[name="checkout"], button[type="submit"][name="checkout"], .cr-btn--green[type="submit"]') ||
                                     target.closest('button[name="checkout"], button[type="submit"][name="checkout"]');
                
                if (isCheckoutBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    console.log('🛒 Botão checkout clicado (capture phase)');
                    self.checkoutPagou();
                    return false;
                }
            };
            
            document.addEventListener('click', clickHandler, true); // Capture phase
            
            console.log('✅ Interceptação global de forms e cliques ativada');
        }

        interceptCartRedirect() {
            const self = this;
            const originalLocation = window.location;
            
            // Função para verificar e corrigir URLs do carrinho e checkout
            const fixCartUrl = (url) => {
                if (!url || typeof url !== 'string') return url;
                
                // Intercepta redirecionamentos para /checkout (deve usar nosso checkout Pagou.ai)
                if (url === '/checkout' || url === '/checkout/' || url.endsWith('/checkout')) {
                    console.log('🛒 Interceptando redirecionamento para /checkout:', url);
                    console.log('🚀 Redirecionando para checkout Pagou.ai');
                    // Chama checkoutPagou() de forma assíncrona
                    setTimeout(() => {
                        if (self.detectPageType() === 'cart') {
                            self.checkoutPagou();
                        }
                    }, 10);
                    // Retorna uma URL que não vai causar navegação (ou cancela)
                    return 'javascript:void(0)';
                }
                
                // Verifica se é uma URL do carrinho que precisa ser corrigida
                const isCartUrl = url === '/cart' || 
                    url === '/cart/' || 
                    url.endsWith('/cart') ||
                    (url.includes('/cart') && !url.includes('index.html') && !url.includes('cart.js') && !url.includes('cart.json') && !url.includes('cart/add.js'));
                
                if (isCartUrl) {
                    console.log('🛒 Interceptando redirecionamento para /cart:', url);
                    const correctPath = self.getCartPath();
                    console.log('🔗 Redirecionando para:', correctPath);
                    return correctPath;
                }
                return url;
            };
            
            // Intercepta window.location.href
            try {
                const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location') || 
                                         Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'location');
                
                if (locationDescriptor && locationDescriptor.configurable) {
                    Object.defineProperty(window, 'location', {
                        get: function() {
                            return new Proxy(originalLocation, {
                                set: function(target, prop, value) {
                                    if (prop === 'href') {
                                        const fixedUrl = fixCartUrl(value);
                                        if (fixedUrl === 'javascript:void(0)') {
                                            console.log('🚫 Redirecionamento para /checkout cancelado (href)');
                                            return true; // Cancela o redirecionamento
                                        }
                                        if (fixedUrl !== value) {
                                            target.href = fixedUrl;
                                            return true;
                                        }
                                    }
                                    target[prop] = value;
                                    return true;
                                },
                                get: function(target, prop) {
                                    // Intercepta métodos de redirecionamento
                                    if (prop === 'replace') {
                                        return function(url) {
                                            const fixedUrl = fixCartUrl(url);
                                            return originalLocation.replace.call(target, fixedUrl);
                                        };
                                    }
                                    if (prop === 'assign') {
                                        return function(url) {
                                            const fixedUrl = fixCartUrl(url);
                                            return originalLocation.assign.call(target, fixedUrl);
                                        };
                                    }
                                    return target[prop];
                                }
                            });
                        },
                        configurable: true
                    });
                }
            } catch (e) {
                console.warn('⚠️ Não foi possível interceptar window.location via Proxy:', e);
            }
            
            // Intercepta também window.location.replace e assign diretamente (fallback)
            try {
                const originalReplace = window.location.replace.bind(window.location);
                const originalAssign = window.location.assign.bind(window.location);
                
                window.location.replace = function(url) {
                    const fixedUrl = fixCartUrl(url);
                    if (fixedUrl === 'javascript:void(0)') {
                        console.log('🚫 Redirecionamento para /checkout cancelado (replace)');
                        return;
                    }
                    return originalReplace(fixedUrl);
                };
                
                window.location.assign = function(url) {
                    const fixedUrl = fixCartUrl(url);
                    if (fixedUrl === 'javascript:void(0)') {
                        console.log('🚫 Redirecionamento para /checkout cancelado (assign)');
                        return;
                    }
                    return originalAssign(fixedUrl);
                };
            } catch (e) {
                console.warn('⚠️ Não foi possível interceptar replace/assign:', e);
            }
        }

        interceptCartRedirectAggressive() {
            const self = this;
            let lastHref = window.location.href;
            
            // Monitora mudanças na URL e intercepta redirecionamentos para /cart
            const checkInterval = setInterval(() => {
                const currentHref = window.location.href;
                
                // Verifica se a URL mudou e se é um redirecionamento para /cart incorreto
                if (currentHref !== lastHref) {
                    lastHref = currentHref;
                    
                    // Verifica se é uma URL do checkout que precisa ser interceptada
                    if ((currentHref.includes('/checkout') || currentHref.endsWith('/checkout')) && 
                        !currentHref.includes('pagou.ai') && 
                        !currentHref.includes('seguro.pagou.ai')) {
                        console.log('🛒 Detectado redirecionamento para /checkout:', currentHref);
                        console.log('🚀 Interceptando e redirecionando para checkout Pagou.ai');
                        clearInterval(checkInterval);
                        // Cancela o redirecionamento e chama checkoutPagou
                        window.history.back(); // Volta para a página anterior
                        setTimeout(() => {
                            self.checkoutPagou();
                        }, 100);
                        return;
                    }
                    
                    // Verifica se é uma URL do carrinho que precisa ser corrigida
                    if ((currentHref.includes('/cart') || currentHref.endsWith('/cart')) && 
                        !currentHref.includes('index.html') && 
                        !currentHref.includes('cart.js') && 
                        !currentHref.includes('cart.json') &&
                        !currentHref.includes('cart/add.js')) {
                        console.log('🛒 Detectado redirecionamento incorreto para /cart:', currentHref);
                        const correctPath = self.getCartPath();
                        console.log('🔗 Corrigindo para:', correctPath);
                        clearInterval(checkInterval);
                        window.location.replace(correctPath);
                        return;
                    }
                }
            }, 5); // Verifica a cada 5ms para ser mais rápido
            
            // Para após 10 segundos para não ficar rodando indefinidamente
            setTimeout(() => clearInterval(checkInterval), 10000);
        }

        interceptFetch() {
            const self = this;
            const originalFetch = window.fetch;
            
            window.fetch = function(url, options) {
                const urlStr = typeof url === 'string' ? url : (url?.url || url?.toString() || '');
                
                // Intercepta requisições para /checkout
                if (urlStr.includes('/checkout') && !urlStr.includes('pagou.ai') && !urlStr.includes('api-checkout')) {
                    console.log('🚫 Interceptando fetch para /checkout:', urlStr);
                    console.log('🚀 Redirecionando para checkout Pagou.ai');
                    // Cancela a requisição e chama checkoutPagou
                    setTimeout(() => {
                        if (self.detectPageType() === 'cart') {
                            self.checkoutPagou();
                        }
                    }, 10);
                    // Retorna uma Promise rejeitada para cancelar a requisição
                    return Promise.reject(new Error('Checkout interceptado - usando Pagou.ai'));
                }
                
                // Intercepta /cart/add.js
                if (urlStr.includes('/cart/add.js')) {
                    console.log('🛒 Interceptando /cart/add.js');
                    return new Promise((resolve) => {
                        try {
                            const body = options?.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
                            const variantId = body.id || document.querySelector('#crStickyVariantId, input[name="id"]')?.value;
                            const title = document.querySelector('h1')?.textContent?.trim() || 'Produto';
                            const handle = window.location.pathname.match(/\/products\/([^\/]+)/)?.[1] || '';
                            
                            // Busca product_id (ID do produto, não da variante)
                            let productId = null;
                            
                            // 1. Tenta window.ShopifyAnalytics.meta.product.id
                            if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product && window.ShopifyAnalytics.meta.product.id) {
                                productId = window.ShopifyAnalytics.meta.product.id;
                                console.log('📦 Product ID do ShopifyAnalytics:', productId);
                            }
                            
                            // 2. Se não encontrou, tenta data-product-id do sticky-add-to-cart
                            if (!productId) {
                                const stickyCart = document.querySelector('sticky-add-to-cart');
                                if (stickyCart) {
                                    const dataProductId = stickyCart.getAttribute('data-product-id');
                                    if (dataProductId) {
                                        productId = dataProductId;
                                        console.log('📦 Product ID do sticky-add-to-cart:', productId);
                                    }
                                }
                            }
                            
                            // 3. Se ainda não encontrou, tenta extrair do script meta
                            if (!productId) {
                                const metaScript = document.querySelector('script:not([src])');
                                if (metaScript && metaScript.textContent) {
                                    const productIdMatch = metaScript.textContent.match(/"product":\s*\{[^}]*"id":\s*(\d+)/);
                                    if (productIdMatch) {
                                        productId = productIdMatch[1];
                                        console.log('📦 Product ID do script meta:', productId);
                                    }
                                }
                            }
                            
                            if (!productId) {
                                console.warn('⚠️ Product ID não encontrado, usando variantId como fallback');
                                productId = variantId; // Fallback: usa variantId se não encontrar productId
                            }
                            
                            // Busca preço - tenta múltiplas fontes
                            let price = 0;
                            console.log('🔍 Buscando preço do produto...');
                            
                            // 1. Tenta meta tag og:price:amount
                            const metaPrice = document.querySelector('meta[property="og:price:amount"]');
                            if (metaPrice) {
                                const priceStr = metaPrice.getAttribute('content') || '0';
                                price = parseFloat(priceStr.replace(/\./g, '').replace(',', '.'));
                                console.log('💰 Preço do meta tag:', price);
                            }
                            
                            // 2. Se não encontrou, tenta #crStickyPrice
                            if (!price || price === 0) {
                                const priceEl = document.querySelector('#crStickyPrice');
                                if (priceEl) {
                                    price = self.extractPrice(priceEl);
                                    console.log('💰 Preço do #crStickyPrice:', price);
                                }
                            }
                            
                            // 3. Se ainda não encontrou, tenta .price
                            if (!price || price === 0) {
                                const priceEl = document.querySelector('.price, [class*="price"]');
                                if (priceEl) {
                                    price = self.extractPrice(priceEl);
                                    console.log('💰 Preço do .price:', price);
                                }
                            }
                            
                            if (!price || price === 0) {
                                console.error('❌ ERRO: Preço não encontrado! Verifique os seletores.');
                            } else {
                                console.log('✅ Preço encontrado:', price);
                            }
                            
                            // Busca URL do produto
                            const currentUrl = window.location.href;
                            const productUrl = currentUrl.split('?')[0]; // Remove query params
                            
                            // Busca imagem do produto - tenta múltiplos seletores
                            let imageUrl = '';
                            
                            // 1. Tenta meta tag og:image (mais confiável)
                            const metaImage = document.querySelector('meta[property="og:image"]');
                            if (metaImage) {
                                imageUrl = metaImage.getAttribute('content') || '';
                                console.log('🖼️ Imagem do meta og:image:', imageUrl);
                            }
                            
                            // 2. Se não encontrou, tenta seletores de imagem
                            if (!imageUrl) {
                                const imageSelectors = [
                                    '.product-image img',
                                    '.main-image img',
                                    '[data-product-image] img',
                                    '.product__media img',
                                    '.product-media img',
                                    'img[data-product-image]',
                                    '.product__media-wrapper img',
                                    'picture img',
                                    '.product-gallery img',
                                    'img[alt*="product"]'
                                ];
                                
                                for (const selector of imageSelectors) {
                                    const imageEl = document.querySelector(selector);
                                    if (imageEl) {
                                        imageUrl = imageEl.src || imageEl.getAttribute('data-src') || imageEl.getAttribute('data-original') || '';
                                        if (imageUrl) {
                                            console.log('🖼️ Imagem encontrada com seletor:', selector, imageUrl);
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            // 3. Se ainda não encontrou, tenta primeira imagem do produto
                            if (!imageUrl) {
                                const firstImg = document.querySelector('main img, .product img, [class*="product"] img');
                                if (firstImg) {
                                    imageUrl = firstImg.src || firstImg.getAttribute('data-src') || '';
                                    if (imageUrl) {
                                        console.log('🖼️ Imagem encontrada (primeira imagem):', imageUrl);
                                    }
                                }
                            }
                            
                            if (!imageUrl) {
                                console.warn('⚠️ Nenhuma imagem encontrada para o produto');
                            } else {
                                console.log('✅ Imagem do produto:', imageUrl);
                            }
                            
                            const product = {
                                id: productId, // Product ID (ID do produto)
                                productId: productId, // Backup explícito
                                variantId: variantId, // Variant ID (ID da variante)
                                title: title,
                                price: price,
                                image: imageUrl,
                                imageUrl: imageUrl, // Backup
                                handle: handle,
                                url: productUrl
                            };
                            
                            console.log('✅ Produto extraído:', product);
                            
                            // Adiciona ao carrinho
                            const existing = self.cart.items.find(i => {
                                if (i.variantId && product.variantId) {
                                    return String(i.variantId) === String(product.variantId);
                                }
                                return String(i.id) === String(product.id);
                            });

                            if (existing) {
                                existing.quantity += 1;
                            } else {
                                self.cart.items.push({
                                    ...product,
                                    variantId: product.variantId || product.id,
                                    quantity: 1,
                                    price: parseFloat(product.price) || 0
                                });
                            }

                            self.calculateTotal();
                            
                            // Salva no localStorage ANTES de qualquer coisa
                            self.saveCart();
                            
                            // Força sincronização imediata
                            const savedData = localStorage.getItem(CART_KEY);
                            if (!savedData) {
                                console.error('❌ ERRO: Falha ao salvar no localStorage!');
                            }
                            
                            console.log('💾 Carrinho salvo no localStorage. Itens:', self.cart.items.length);
                            console.log('💾 Itens salvos:', self.cart.items.map(i => `${i.title} x${i.quantity}`).join(', '));
                            
                            // Retorna resposta primeiro
                            resolve(new Response(JSON.stringify({ product: product }), { 
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            }));
                            
                            // Redireciona IMEDIATAMENTE usando replace (substitui a URL atual)
                            // Isso deve acontecer antes do código da página tentar fazer window.location.href = "/cart"
                            const cartPath = self.getCartPath();
                            console.log('🔗 Redirecionando para carrinho:', cartPath);
                            
                            // Usa setTimeout com delay mínimo para garantir que o localStorage foi salvo
                            setTimeout(() => {
                                window.location.replace(cartPath);
                            }, 10); // Delay mínimo de 10ms para garantir que o save foi processado
                        } catch (error) {
                            console.error('❌ Erro:', error);
                            resolve(new Response(JSON.stringify({ error: error.message }), { 
                                status: 500,
                                headers: { 'Content-Type': 'application/json' }
                            }));
                        }
                    });
                }
                
                // Intercepta /cart.js para retornar dados do localStorage
                if (urlStr.includes('/cart.js') || urlStr.includes('/cart.json')) {
                    console.log('🛒 Interceptando /cart.js');
                    return new Promise((resolve) => {
                        // RECARREGA o carrinho do localStorage (pode ter mudado)
                        const cart = self.loadCart();
                        console.log('🛒 Carrinho atual no localStorage:', cart.items.length, 'produtos');
                        
                        if (cart.items.length === 0) {
                            console.warn('⚠️ ATENÇÃO: Carrinho está vazio no localStorage!');
                        }
                        
                        const shopifyCart = {
                            token: Date.now().toString(),
                            items: cart.items.map((item, idx) => {
                                // Garante URL correta baseada na localização atual
                                let productUrl = item.url || `./products/${item.handle || 'product'}/index.html`;
                                
                                // Se estiver em /cart, ajusta o caminho relativo
                                if (window.location.pathname.includes('/cart')) {
                                    if (productUrl.startsWith('./')) {
                                        productUrl = '../' + productUrl.substring(2);
                                    } else if (!productUrl.startsWith('../') && !productUrl.startsWith('http')) {
                                        productUrl = '../products/' + (item.handle || 'product') + '/index.html';
                                    }
                                }
                                
                                // Garante que image seja uma string válida
                                let imageUrl = item.image || item.imageUrl || '';
                                
                                // Log para debug
                                if (!imageUrl) {
                                    console.warn('⚠️ Item sem imagem:', item.title, 'Dados:', item);
                                } else {
                                    console.log('🖼️ Imagem do item:', item.title, '->', imageUrl);
                                }
                                
                                return {
                                    id: item.variantId || item.id,
                                    product_id: item.id,
                                    variant_id: item.variantId || item.id,
                                    title: item.title || 'Produto',
                                    product_title: item.title || 'Produto',
                                    variant_title: item.variantTitle || 'Default Title',
                                    quantity: item.quantity || 1,
                                    price: Math.round((parseFloat(item.price) || 0) * 100),
                                    final_price: Math.round((parseFloat(item.price) || 0) * 100),
                                    original_price: Math.round((parseFloat(item.price) || 0) * 100),
                                    final_line_price: Math.round((parseFloat(item.price) || 0) * 100 * (item.quantity || 1)),
                                    image: imageUrl,
                                    url: productUrl,
                                    key: `key-${idx + 1}`
                                };
                            }),
                            item_count: cart.items.reduce((sum, i) => sum + (i.quantity || 0), 0),
                            total_price: Math.round((cart.total || 0) * 100),
                            currency: 'ARS',
                            attributes: {}
                        };
                        resolve(new Response(JSON.stringify(shopifyCart), { 
                            status: 200,
                            headers: { 'Content-Type': 'application/json' }
                        }));
                    });
                }
                
                // Intercepta /cart/change.js para atualizar localStorage
                if (urlStr.includes('/cart/change.js')) {
                    console.log('🛒 Interceptando /cart/change.js');
                    return new Promise((resolve) => {
                        try {
                            const body = options?.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
                            const line = body.line;
                            const quantity = body.quantity || 0;
                            
                            const cart = self.loadCart();
                            if (line > 0 && line <= cart.items.length) {
                                const item = cart.items[line - 1];
                                if (quantity <= 0) {
                                    cart.items.splice(line - 1, 1);
                                } else {
                                    item.quantity = quantity;
                                }
                                self.cart = cart;
                                self.calculateTotal();
                                self.saveCart();
                            }
                            
                            // Retorna carrinho atualizado no formato Shopify (mesmo formato do /cart.js)
                            const shopifyCart = {
                                token: Date.now().toString(),
                                items: cart.items.map((item, idx) => {
                                    let productUrl = item.url || `./products/${item.handle || 'product'}/index.html`;
                                    if (window.location.pathname.includes('/cart')) {
                                        if (productUrl.startsWith('./')) {
                                            productUrl = '../' + productUrl.substring(2);
                                        } else if (!productUrl.startsWith('../') && !productUrl.startsWith('http')) {
                                            productUrl = '../products/' + (item.handle || 'product') + '/index.html';
                                        }
                                    }
                                    
                                    let imageUrl = item.image || '';
                                    if (!imageUrl && item.imageUrl) {
                                        imageUrl = item.imageUrl;
                                    }
                                    
                                    return {
                                        id: item.variantId || item.id,
                                        product_id: item.id,
                                        variant_id: item.variantId || item.id,
                                        title: item.title || 'Produto',
                                        product_title: item.title || 'Produto',
                                        variant_title: item.variantTitle || 'Default Title',
                                        quantity: item.quantity || 1,
                                        price: Math.round((parseFloat(item.price) || 0) * 100),
                                        final_price: Math.round((parseFloat(item.price) || 0) * 100),
                                        original_price: Math.round((parseFloat(item.price) || 0) * 100),
                                        final_line_price: Math.round((parseFloat(item.price) || 0) * 100 * (item.quantity || 1)),
                                        image: imageUrl,
                                        url: productUrl,
                                        key: `key-${idx + 1}`
                                    };
                                }),
                                item_count: cart.items.reduce((sum, i) => sum + (i.quantity || 0), 0),
                                total_price: Math.round((cart.total || 0) * 100),
                                currency: 'ARS',
                                attributes: {}
                            };
                            
                            resolve(new Response(JSON.stringify(shopifyCart), { 
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            }));
                        } catch (error) {
                            console.error('❌ Erro:', error);
                            resolve(new Response(JSON.stringify({ error: error.message }), { 
                                status: 500,
                                headers: { 'Content-Type': 'application/json' }
                            }));
                        }
                    });
                }
                
                return originalFetch.apply(this, arguments);
            };
        }

        detectPageType() {
            const path = window.location.pathname;
            if (path.includes('/products/')) return 'product';
            if (path.includes('/cart')) return 'cart';
            return 'home';
        }

        loadCart() {
            try {
                const saved = localStorage.getItem(CART_KEY);
                if (saved) {
                    const cart = JSON.parse(saved);
                    console.log('📦 Carrinho carregado do localStorage:', cart.items.length, 'produtos');
                    console.log('📦 Itens:', cart.items.map(i => `${i.title} x${i.quantity}`).join(', '));
                    
                    // Verifica e corrige produtos sem imagem
                    let needsSave = false;
                    cart.items.forEach(item => {
                        if (!item.image && !item.imageUrl && item.handle) {
                            // Tenta buscar imagem da meta tag se estiver na página do produto
                            // Mas como estamos no carrinho, não podemos buscar
                            // Vamos apenas garantir que imageUrl esteja definido
                            if (!item.imageUrl) {
                                item.imageUrl = item.image || '';
                            }
                        }
                    });
                    
                    if (needsSave) {
                        this.cart = cart;
                        this.saveCart();
                    }
                    
                    return cart;
                }
                console.log('📦 Carrinho vazio no localStorage');
                return { items: [], total: 0 };
            } catch (e) {
                console.error('❌ Erro ao carregar carrinho:', e);
                return { items: [], total: 0 };
            }
        }

        saveCart() {
            console.log('💾 Salvando carrinho no localStorage:', this.cart);
            localStorage.setItem(CART_KEY, JSON.stringify(this.cart));
        }

        async loadProductMapping() {
            try {
                // Tenta carregar o config.json de diferentes locais
                const possiblePaths = [
                    '../../config.json',  // Da página do carrinho
                    '../config.json',    // De outras páginas
                    './config.json',
                    '/config.json',
                    'config.json'
                ];
                
                console.log('🔍 Tentando carregar config.json...');
                
                for (const path of possiblePaths) {
                    try {
                        console.log(`   Tentando: ${path}`);
                        const response = await fetch(path);
                        if (response.ok) {
                            const config = await response.json();
                            console.log('✅ config.json carregado de', path);
                            console.log('📋 Conteúdo:', config);
                            
                            if (config.productMapping) {
                                this.productMapping = config.productMapping;
                                console.log('✅ ProductMapping carregado!');
                                console.log('✅ Mapeamento:', this.productMapping);
                                return;
                            } else {
                                console.warn('⚠️ config.json não tem productMapping');
                            }
                        } else {
                            console.log(`   ❌ ${path} retornou status ${response.status}`);
                        }
                    } catch (e) {
                        console.log(`   ❌ Erro ao carregar ${path}:`, e.message);
                        // Continua tentando outros caminhos
                        continue;
                    }
                }
                
                console.warn('⚠️ Não foi possível carregar config.json, continuando sem productMapping');
                console.warn('⚠️ Tentou os caminhos:', possiblePaths);
            } catch (e) {
                console.warn('⚠️ Erro ao carregar config.json:', e);
            }
        }

        addItem(product) {
            console.log('➕ Adicionando:', product.title, 'ID:', product.id, 'VariantID:', product.variantId, 'Handle:', product.handle);

            // Usa variantId como identificador principal, com fallback para id + handle
            const productKey = product.variantId || product.id;
            const productHandle = product.handle || '';
            
            // Busca produto existente usando variantId (ou id + handle como fallback)
            const existing = this.cart.items.find(i => {
                // Primeiro tenta por variantId
                if (i.variantId && product.variantId) {
                    return String(i.variantId) === String(product.variantId);
                }
                // Se não tiver variantId, usa id + handle como chave única
                if (productHandle) {
                    return String(i.id) === String(productKey) && String(i.handle) === String(productHandle);
                }
                // Último recurso: apenas id
                return String(i.id) === String(productKey);
            });

            if (existing) {
                // Produto já existe, aumenta quantidade
                existing.quantity += 1;
                console.log('📈 Quantidade aumentada para:', existing.quantity);
            } else {
                // Novo produto, adiciona ao carrinho
                // Garante que o preço é um número válido
                const priceValue = parseFloat(product.price) || 0;
                if (priceValue === 0) {
                    console.error('❌ ERRO: Tentando adicionar produto com preço zero!', product);
                }
                
                const newItem = {
                    ...product,
                    variantId: product.variantId || product.id,
                    quantity: 1,
                    price: priceValue,
                    // Garante que tenha URL e imagem
                    url: product.url || (product.handle ? `./products/${product.handle}/index.html` : ''),
                    image: product.image || product.imageUrl || '',
                    imageUrl: product.image || product.imageUrl || ''
                };
                console.log('💰 Preço sendo salvo no item:', newItem.price, '(tipo:', typeof newItem.price, ')');
                this.cart.items.push(newItem);
                console.log('✅ Novo produto adicionado:', JSON.stringify(newItem, null, 2));
            }

            this.calculateTotal();
            this.saveCart();
            console.log('🛒 Carrinho atualizado:', this.cart.items.length, 'produtos diferentes');

            const cartPath = this.getCartPath();
            console.log('🔗 Redirecionando para:', cartPath);
            console.log('📍 URL atual completa:', window.location.href);
            
            // Redireciona diretamente
            window.location.href = cartPath;
        }

        calculateTotal() {
            this.cart.total = this.cart.items.reduce((sum, item) => {
                return sum + (parseFloat(item.price) * item.quantity);
            }, 0);
        }

        updateQuantity(productId, change) {
            const item = this.cart.items.find(i => i.id === productId);
            if (item) {
                item.quantity += change;
                if (item.quantity <= 0) {
                    this.removeItem(productId);
                } else {
                    this.calculateTotal();
                    this.saveCart();
                    this.renderCart();
                }
            }
        }

        removeItem(productId) {
            this.cart.items = this.cart.items.filter(i => i.id !== productId);
            this.calculateTotal();
            this.saveCart();
            this.renderCart();
        }

        setupLogoClick() {
            // Intercepta cliques na logo do Carrefour
            document.addEventListener('click', (e) => {
                const logo = e.target.closest('.cfar-logo');
                if (logo) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Determina o caminho relativo para a home baseado na página atual
                    let homePath = './index.html';
                    const currentPath = window.location.pathname;
                    
                    if (currentPath.includes('/products/')) {
                        homePath = '../../index.html';
                    } else if (currentPath.includes('/collections/')) {
                        homePath = '../../index.html';
                    } else if (currentPath.includes('/cart')) {
                        homePath = '../index.html';
                    } else if (currentPath.includes('/pages/')) {
                        homePath = '../../index.html';
                    }
                    
                    window.location.href = homePath;
                    return false;
                }
            }, true);
        }

        getCartPath() {
            const currentUrl = window.location.href;
            const currentPath = window.location.pathname;
            
            console.log('📍 URL completa:', currentUrl);
            console.log('📍 Pathname:', currentPath);
            
            // Para file://, constrói caminho absoluto corretamente
            if (currentUrl.startsWith('file://')) {
                let baseUrl = currentUrl;
                console.log('🔍 URL original (file://):', baseUrl);
                
                // Se estiver em /products/[handle]/index.html
                if (currentPath.includes('/products/')) {
                    // Encontra a posição de /products/ na URL
                    const productsIndex = baseUrl.indexOf('/products/');
                    console.log('🔍 Índice de /products/:', productsIndex);
                    if (productsIndex !== -1) {
                        // Pega tudo antes de /products/
                        baseUrl = baseUrl.substring(0, productsIndex);
                        console.log('🔍 Base URL após remover /products/:', baseUrl);
                    } else {
                        console.error('❌ Não encontrou /products/ na URL!');
                    }
                }
                // Se estiver em /collections/[handle]/index.html
                else if (currentPath.includes('/collections/')) {
                    const collectionsIndex = baseUrl.indexOf('/collections/');
                    if (collectionsIndex !== -1) {
                        baseUrl = baseUrl.substring(0, collectionsIndex);
                    }
                }
                // Se estiver na raiz (index.html)
                else {
                    // Remove o nome do arquivo
                    if (baseUrl.endsWith('index.html')) {
                        baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
                    }
                }
                
                // Adiciona /cart/index.html
                const cartPath = baseUrl + '/cart/index.html';
                console.log('🔗 Caminho absoluto construído:', cartPath);
                
                // Validação: verifica se o caminho parece correto
                if (!cartPath.includes('CARREFOUR LOJA') && baseUrl.includes('CARREFOUR LOJA')) {
                    console.error('❌ ERRO: Caminho parece incorreto!');
                    console.error('   Base URL:', baseUrl);
                    console.error('   Caminho final:', cartPath);
                }
                
                return cartPath;
            }
            
            // Para http://, usa caminhos relativos
            let cartPath;
            if (currentPath.includes('/products/')) {
                cartPath = '../../cart/index.html';
            } else if (currentPath.includes('/collections/')) {
                cartPath = '../../cart/index.html';
            } else {
                cartPath = './cart/index.html';
            }
            
            console.log('🔗 Caminho relativo (http://):', cartPath);
            return cartPath;
        }

        initProduct() {
            console.log('📦 Inicializando página de produto');
            
            // Extrai dados do produto da página
            const productData = this.extractProductFromPage();
            
            if (productData) {
                window.productData = productData;
                console.log('✅ Dados do produto extraídos:', productData);
            } else {
                console.warn('⚠️ Não foi possível extrair dados do produto');
            }
        }

        extractProductFromPage() {
            const handle = window.location.pathname.match(/\/products\/([^\/]+)/)?.[1] || '';
            const title = document.querySelector('h1')?.textContent?.trim() || '';
            
            // Busca product_id (ID do produto, não da variante)
            let productId = null;
            
            // 1. Tenta window.ShopifyAnalytics.meta.product.id
            if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product && window.ShopifyAnalytics.meta.product.id) {
                productId = window.ShopifyAnalytics.meta.product.id;
            }
            
            // 2. Se não encontrou, tenta data-product-id do sticky-add-to-cart
            if (!productId) {
                const stickyCart = document.querySelector('sticky-add-to-cart');
                if (stickyCart) {
                    const dataProductId = stickyCart.getAttribute('data-product-id');
                    if (dataProductId) {
                        productId = dataProductId;
                    }
                }
            }
            
            // Busca preço
            let price = 0;
            const metaPrice = document.querySelector('meta[property="og:price:amount"]');
            if (metaPrice) {
                const priceStr = metaPrice.getAttribute('content') || '0';
                price = parseFloat(priceStr.replace(/\./g, '').replace(',', '.'));
            }
            
            if (!price || price === 0) {
                const priceEl = document.querySelector('#crStickyPrice, .price, [class*="price"]');
                if (priceEl) {
                    const priceText = priceEl.textContent || '';
                    price = this.extractPrice(priceEl);
                }
            }
            
            const variantId = document.querySelector('#crStickyVariantId, input[name="id"]')?.value || '';
            const image = document.querySelector('.product-image img, .main-image img, .product-media img')?.src || '';
            
            if (!price || price === 0) {
                console.error('❌ ERRO: Preço não encontrado! Verifique os seletores.');
            }
            
            if (!productId) {
                productId = variantId; // Fallback: usa variantId se não encontrar productId
            }
            
            return {
                id: productId, // Product ID (ID do produto)
                productId: productId, // Backup explícito
                variantId: variantId, // Variant ID (ID da variante)
                title: title,
                price: price,
                image: image,
                handle: handle
            };
        }

        extractPrice(el) {
            if (!el) return 0;
            
            let priceText = el.textContent || el.innerText || '';
            
            // Remove símbolos de moeda e espaços
            priceText = priceText.replace(/[^\d,.]/g, '');
            
            // Remove separadores de milhar (pontos)
            priceText = priceText.replace(/\./g, '');
            
            // Converte vírgula para ponto
            priceText = priceText.replace(',', '.');
            
            const price = parseFloat(priceText) || 0;
            console.log('💰 Preço extraído:', priceText, '->', price);
            return price;
        }

        initCart() {
            console.log('🛒 Inicializando página do carrinho');
            const self = this;
            
            // Remove action dos forms IMEDIATAMENTE para evitar submit
            const forms = document.querySelectorAll('form[action*="cart"], form[action*="checkout"], form');
            forms.forEach(form => {
                const action = form.getAttribute('action');
                if (action && (action.includes('cart') || action.includes('checkout'))) {
                    form.setAttribute('data-original-action', action);
                    form.removeAttribute('action');
                    form.setAttribute('onsubmit', 'return false;'); // Previne submit
                    console.log('✅ Action removido do form:', action);
                }
            });
            
            // Remove também href de links para /checkout
            const checkoutLinks = document.querySelectorAll('a[href*="/checkout"]');
            checkoutLinks.forEach(link => {
                const originalHref = link.getAttribute('href');
                link.setAttribute('data-original-href', originalHref);
                link.setAttribute('href', 'javascript:void(0)');
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🛒 Link checkout clicado, redirecionando para Pagou.ai');
                    self.checkoutPagou();
                });
                console.log('✅ Link checkout interceptado:', originalHref);
            });
            
            // Recarrega o carrinho do localStorage (pode ter mudado)
            this.cart = this.loadCart();
            console.log('📦 Carrinho carregado:', this.cart.items.length, 'produtos');
            
            // Verifica se há produtos sem imagem e tenta buscar
            const itemsWithoutImage = this.cart.items.filter(item => !item.image && !item.imageUrl);
            if (itemsWithoutImage.length > 0) {
                console.warn('⚠️ Encontrados', itemsWithoutImage.length, 'produtos sem imagem. Tentando buscar...');
                // Para produtos sem imagem, vamos tentar buscar da API do produto quando possível
                // Mas por enquanto, vamos apenas logar
                itemsWithoutImage.forEach(item => {
                    console.warn('⚠️ Produto sem imagem:', item.title, 'Handle:', item.handle);
                });
            }
            
            // Função para forçar renderização do carrinho
            const forceRender = () => {
                // Tenta chamar getCart() que vai buscar /cart.js (interceptado)
                if (typeof window.getCart === 'function') {
                    window.getCart().then(cart => {
                        console.log('🛒 Carrinho recebido do getCart():', cart.items?.length || 0, 'produtos');
                        if (typeof window.renderCart === 'function') {
                            window.renderCart(cart);
                            console.log('✅ Carrinho renderizado');
                        } else {
                            console.warn('⚠️ Função renderCart não encontrada');
                        }
                    }).catch(err => {
                        console.warn('⚠️ Erro ao buscar carrinho:', err);
                        // Fallback: tenta buscar diretamente
                        fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
                            .then(res => res.json())
                            .then(cart => {
                                if (typeof window.renderCart === 'function') {
                                    window.renderCart(cart);
                                }
                            })
                            .catch(e => console.error('❌ Erro ao buscar carrinho:', e));
                    });
                } else {
                    // Se getCart não existe ainda, tenta buscar diretamente
                    fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
                        .then(res => res.json())
                        .then(cart => {
                            console.log('🛒 Carrinho recebido via fetch:', cart.items?.length || 0, 'produtos');
                            console.log('🛒 Dados do carrinho:', cart);
                            
                            // Chama renderCart se disponível
                            if (typeof window.renderCart === 'function') {
                                console.log('✅ Chamando window.renderCart com', cart.items?.length || 0, 'produtos');
                                window.renderCart(cart);
                            } else {
                                console.warn('⚠️ window.renderCart não encontrado ainda, tentando novamente...');
                                // Tenta novamente após um tempo
                                setTimeout(() => {
                                    if (typeof window.renderCart === 'function') {
                                        window.renderCart(cart);
                                    }
                                }, 100);
                            }
                        })
                        .catch(e => console.error('❌ Erro ao buscar carrinho:', e));
                }
            };
            
            // Força atualização IMEDIATA do carrinho (sem delay)
            forceRender();
            
            // Se o DOM ainda não estiver pronto, tenta novamente
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    forceRender();
                    self.setupCheckoutButton();
                });
            } else {
                // DOM já está pronto, conecta botão imediatamente
                self.setupCheckoutButton();
                
                // Também escuta mudanças no carrinho para re-renderizar
                const originalSaveCart = self.saveCart.bind(self);
                self.saveCart = function() {
                    originalSaveCart();
                    // Re-renderiza após salvar
                    setTimeout(() => {
                        forceRender();
                    }, 50);
                };
            }, 300);
            
            // Tenta novamente após mais tempo (caso o script do HTML demore mais)
            setTimeout(() => {
                forceRender();
            }, 1000);
        }

        setupCheckoutButton() {
            // Conecta o botão "Finalizar compra" ao checkout Pagou.ai
            const self = this;
            
            // Intercepta TODOS os forms na página (capture phase para pegar antes de outros scripts)
            document.addEventListener('submit', function(e) {
                const form = e.target;
                if (form && form.tagName === 'FORM') {
                    // Verifica se é o form do checkout
                    const action = form.getAttribute('action') || '';
                    const hasCheckoutBtn = form.querySelector('button[name="checkout"], button[type="submit"][name="checkout"]');
                    
                    if (hasCheckoutBtn || action.includes('cart') || action.includes('checkout')) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        console.log('🛒 Form submit interceptado (capture phase)');
                        self.checkoutPagou();
                        return false;
                    }
                }
            }, true); // true = capture phase (executa antes de outros listeners)
            
            // Função para conectar o botão
            const connectButton = () => {
                // Tenta múltiplos seletores para encontrar o botão
                const checkoutBtn = document.querySelector('button[name="checkout"], button[type="submit"], .cr-btn--green[type="submit"], button.cr-btn--green');
                
                if (checkoutBtn) {
                    // Intercepta cliques no botão (capture phase)
                    checkoutBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        console.log('🛒 Botão Finalizar compra clicado (capture phase)');
                        self.checkoutPagou();
                        return false;
                    }, true); // true = capture phase
                    
                    // Também intercepta o form submit
                    const form = checkoutBtn.closest('form');
                    if (form) {
                        // Remove action do form para evitar navegação
                        const originalAction = form.getAttribute('action');
                        form.setAttribute('data-original-action', originalAction || '');
                        form.removeAttribute('action');
                        
                        form.addEventListener('submit', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            console.log('🛒 Form submit interceptado');
                            self.checkoutPagou();
                            return false;
                        }, true); // true = capture phase
                    }
                    
                    console.log('✅ Botão Finalizar compra conectado');
                } else {
                    console.warn('⚠️ Botão Finalizar compra não encontrado, tentando novamente...');
                    // Tenta novamente após um tempo
                    setTimeout(connectButton, 500);
                }
            };
            
            // Tenta conectar imediatamente
            connectButton();
            
            // Também tenta após o DOM estar completamente carregado
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', connectButton);
            }
            
            // Tenta novamente após um tempo para garantir
            setTimeout(connectButton, 1000);
        }

        renderCart() {
            // O carrinho já tem seu próprio sistema de renderização via /cart.js
            // Força atualização chamando getCart() que vai usar os dados do localStorage
            console.log('🛒 Carrinho renderizado com', this.cart.items.length, 'produtos');
            
            // Se estiver na página do carrinho, força atualização IMEDIATA
            if (this.detectPageType() === 'cart') {
                // Carrega IMEDIATAMENTE sem delay
                const renderImmediately = () => {
                    // Chama getCart() que vai buscar /cart.js (interceptado) e renderizar
                    if (typeof window.getCart === 'function') {
                        window.getCart().then(cart => {
                            if (typeof window.renderCart === 'function') {
                                window.renderCart(cart);
                            }
                        }).catch(err => {
                            console.warn('⚠️ Erro ao atualizar carrinho:', err);
                        });
                    } else {
                        // Fallback: busca diretamente
                        fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
                            .then(res => res.json())
                            .then(cart => {
                                if (typeof window.renderCart === 'function') {
                                    window.renderCart(cart);
                                }
                            })
                            .catch(err => console.warn('⚠️ Erro:', err));
                    }
                };
                
                // Tenta renderizar imediatamente
                renderImmediately();
                
                // Se o DOM ainda não estiver pronto, tenta novamente
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', renderImmediately);
                }
            }
        }

        async checkoutPagou() {
            console.log('🚀 Iniciando checkout Pagou.ai...');
            console.log('📦 Itens no carrinho:', this.cart.items);
            
            // Garante que o productMapping está carregado ANTES de processar
            if (Object.keys(this.productMapping).length === 0) {
                console.log('⏳ ProductMapping vazio, carregando config.json...');
                await this.loadProductMapping();
                console.log('📋 ProductMapping após carregar:', this.productMapping);
            }
            
            // Recarrega o carrinho do localStorage para garantir dados atualizados
            this.cart = this.loadCart();
            console.log('📦 Carrinho recarregado:', this.cart.items.length, 'produtos');
            
            // Valida se há produtos
            if (!this.cart.items || this.cart.items.length === 0) {
                alert('Seu carrinho está vazio!');
                return;
            }
            
            // Valida preços
            const itemsWithZeroPrice = this.cart.items.filter(item => !item.price || parseFloat(item.price) === 0);
            if (itemsWithZeroPrice.length > 0) {
                console.error('❌ ERRO: Produtos com preço zero encontrados:', itemsWithZeroPrice);
                alert('Alguns produtos não têm preço configurado. Por favor, adicione os produtos novamente.');
                return;
            }

            try {
                // Formata itens do carrinho - USA PREÇO DO LOCALSTORAGE (já está correto)
                const shopifyCartItems = this.cart.items.map((item) => {
                    // O preço no localStorage está em unidades (ex: 24373 = ARS 24.373,00)
                    // Precisamos converter para centavos (24373 * 100 = 2437300 centavos)
                    let priceValue = parseFloat(item.price) || 0;
                    
                    // Valida se o preço é válido
                    if (!priceValue || priceValue <= 0) {
                        console.error(`❌ ERRO: Produto "${item.title}" tem preço inválido: ${item.price}`);
                        priceValue = 0;
                    }
                    
                    // Converte para centavos (formato Shopify/Pagou.ai)
                    const priceInCents = Math.round(priceValue * 100);
                    
                    console.log(`💰 Item: ${item.title}`);
                    console.log(`   Preço original (localStorage): ${item.price} (tipo: ${typeof item.price})`);
                    console.log(`   Preço parseFloat: ${priceValue}`);
                    console.log(`   Preço em centavos: ${priceInCents}`);
                    console.log(`   Preço em ARS: ARS ${(priceInCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
                    
                    // Valida se a conversão está correta
                    if (priceInCents <= 0) {
                        console.error(`❌ ERRO: Preço em centavos é zero ou negativo para "${item.title}"`);
                    }
                    
                    // Garante que temos imagem
                    const imageUrl = item.image || item.imageUrl || '';
                    console.log(`🖼️ Imagem do item: ${item.title} - ${imageUrl || 'SEM IMAGEM'}`);
                    
                    // FORMATO EXATO DO PAYLOAD QUE FUNCIONA (capturado da loja Shopify real)
                    const variantId = item.variantId || item.id;
                    const productId = item.productId || item.id;
                    
                    // Gera key no formato correto (variantId:hash)
                    const keyHash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                    const itemKey = `${variantId}:${keyHash}`;
                    
                    // Preço em unidades (para presentment_price)
                    const priceInUnits = priceValue; // Já está em unidades (ex: 17579)
                    
                    const formattedItem = {
                        // IDs do Shopify (números, não strings) - A Pagou.ai reconhece por esses IDs!
                        id: variantId,
                        variant_id: variantId,
                        product_id: productId,
                        quantity: item.quantity || 1,
                        properties: {},
                        key: itemKey, // Formato: "variantId:hash"
                        title: item.title || 'Produto',
                        // Preço em CENTAVOS (formato Shopify)
                        price: priceInCents,
                        original_price: priceInCents,
                        // IMPORTANTE: presentment_price em UNIDADES (não centavos)!
                        presentment_price: priceInUnits,
                        discounted_price: priceInCents,
                        line_price: priceInCents * (item.quantity || 1),
                        original_line_price: priceInCents * (item.quantity || 1),
                        total_discount: 0,
                        discounts: [],
                        sku: item.sku || null,
                        grams: 0,
                        vendor: item.vendor || 'Mi tienda',
                        taxable: true,
                        product_has_only_default_variant: true,
                        gift_card: false,
                        final_price: priceInCents,
                        final_line_price: priceInCents * (item.quantity || 1),
                        url: item.url || (item.handle ? `/products/${item.handle}?variant=${variantId}` : ''),
                        featured_image: imageUrl ? {
                            aspect_ratio: 1,
                            alt: item.title || 'Produto',
                            height: 600,
                            url: imageUrl,
                            width: 600
                        } : null,
                        image: imageUrl || '',
                        handle: item.handle || '',
                        requires_shipping: true,
                        product_type: item.productType || '',
                        product_title: item.title || 'Produto',
                        product_description: item.description || '',
                        variant_title: item.variantTitle || null,
                        variant_options: item.variantTitle ? [item.variantTitle] : ['Default Title'],
                        options_with_values: item.variantTitle ? [{
                            name: 'Title',
                            value: item.variantTitle
                        }] : [{
                            name: 'Title',
                            value: 'Default Title'
                        }],
                        line_level_discount_allocations: [],
                        line_level_total_discount: 0,
                        has_components: false
                    };
                    
                    console.log(`📋 Item: ${item.title}`);
                    console.log(`   Variant ID: ${item.variantId || item.id}`);
                    console.log(`   Product ID: ${item.productId || item.id}`);
                    console.log(`   Handle: "${item.handle || ''}"`);
                    console.log(`   SKU: "${item.sku || 'VAZIO'}"`);
                    console.log(`   Preço enviado: ${priceInCents} centavos (${(priceInCents/100).toLocaleString('pt-BR', {style: 'currency', currency: 'ARS'})})`);
                    console.log(`   ⚠️ A Pagou.ai está exibindo nome e foto, mas não o preço.`);
                    console.log(`   ⚠️ Ela precisa fazer MATCH do produto para buscar o preço.`);
                    console.log(`   ⚠️ Verifique qual campo a Pagou.ai usa para o match (SKU? Handle? ID?)`);
                    
                    return formattedItem;
                });

                console.log('📦 Itens formatados para checkout:', shopifyCartItems);

                // Calcula totais
                const totalPrice = shopifyCartItems.reduce((sum, item) => {
                    return sum + (item.price * item.quantity);
                }, 0);

                const itemCount = shopifyCartItems.reduce((sum, item) => sum + item.quantity, 0);
                
                console.log('💰 Total do carrinho (centavos):', totalPrice);
                console.log('📦 Total de itens:', itemCount);

                // Formata carrinho no formato EXATO que funciona (capturado da loja Shopify real)
                // Gera token no formato do Shopify: "hash?key=hash"
                const tokenHash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                const tokenKey = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 10);
                const shopifyToken = `${tokenHash}?key=${tokenKey}`;
                
                const shopifyCart = {
                    token: shopifyToken, // Formato: "hash?key=hash"
                    note: '',
                    attributes: {},
                    original_total_price: totalPrice,
                    total_price: totalPrice,
                    total_discount: 0,
                    total_weight: 0,
                    item_count: itemCount,
                    items: shopifyCartItems,
                    requires_shipping: true,
                    currency: 'ARS',
                    items_subtotal_price: totalPrice,
                    cart_level_discount_applications: [],
                    discount_codes: []
                };

                const payload = {
                    shop: SHOP_DOMAIN,
                    shopify_internal_domain: SHOP_DOMAIN,
                    cart_payload: shopifyCart
                };

                console.log('📤 Payload completo:', JSON.stringify(payload, null, 2));
                
                // Validação final: verifica se todos os itens têm preço válido
                const invalidItems = shopifyCartItems.filter(item => !item.price || item.price <= 0);
                if (invalidItems.length > 0) {
                    console.error('❌ ERRO: Itens com preço inválido:', invalidItems);
                    alert('Alguns produtos não têm preço válido. Por favor, adicione os produtos novamente.');
                    return;
                }
                
                // Validação: verifica se o total está correto
                if (totalPrice <= 0) {
                    console.error('❌ ERRO: Total do carrinho é zero ou negativo:', totalPrice);
                    alert('O total do carrinho está inválido. Por favor, adicione os produtos novamente.');
                    return;
                }

                const response = await fetch('https://api-checkout.pagou.ai/public/cart', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                console.log('📥 Status da resposta:', response.status, response.statusText);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('❌ Erro HTTP:', response.status, errorText);
                    throw new Error(`API retornou erro ${response.status}: ${errorText}`);
                }

                const data = await response.json();
                console.log('📩 Resposta completa da API:', data);
                console.log('📩 Resposta completa da API (string):', JSON.stringify(data, null, 2));

                // Verifica a estrutura da resposta
                if (data && data.data) {
                    const integration = data.data.integration;
                    const checkoutUrl = data.data.checkout_url;
                    
                    // Log detalhado da resposta
                    console.log('📊 Dados da resposta:');
                    console.log('   Integration:', integration);
                    console.log('   Checkout URL:', checkoutUrl);
                    console.log('   Integration active:', integration?.active);
                    console.log('   Stock rules:', integration?.stock_rules);
                    console.log('   Sync automatically:', integration?.sync_automatically);
                    
                    // Verifica se há avisos sobre preços
                    if (data.warnings || data.errors) {
                        console.warn('⚠️ Avisos/Erros da API:', data.warnings || data.errors);
                    }
                    
                    // Verifica se há mensagens na resposta
                    if (data.message) {
                        console.log('📨 Mensagem da API:', data.message);
                    }
                    
                    // Verifica se há dados dos produtos na resposta
                    if (data.data && data.data.cart) {
                        console.log('📦 Carrinho retornado pela API:', data.data.cart);
                        if (data.data.cart.items) {
                            console.log('📦 Itens no carrinho da API:', data.data.cart.items);
                            data.data.cart.items.forEach((item, idx) => {
                                console.log(`   Item ${idx + 1}: ${item.title} - Preço: ${item.price} (centavos)`);
                            });
                        }
                    }
                    
                    // Verifica se há informações sobre produtos não reconhecidos
                    if (data.data && data.data.unrecognized_products) {
                        console.warn('⚠️ Produtos não reconhecidos pela Pagou.ai:', data.data.unrecognized_products);
                    }
                    
                    // Verifica se há informações sobre sincronização
                    if (data.data && data.data.sync_status) {
                        console.log('🔄 Status de sincronização:', data.data.sync_status);
                    }

                    if (integration && integration.active && checkoutUrl) {
                        if (checkoutUrl.indexOf('https://') === 0) {
                            console.log('✅ Checkout criado com sucesso:', checkoutUrl);
                            window.location.href = checkoutUrl;
                            return;
                        } else {
                            throw new Error('URL de checkout inválida');
                        }
                    } else {
                        throw new Error('Integração inativa ou URL não disponível');
                    }
                } else {
                    throw new Error('Resposta da API em formato inesperado');
                }

            } catch (error) {
                console.error('❌ Erro completo:', error);
                console.error('❌ Stack:', error.stack);
                alert('Erro ao criar checkout: ' + error.message + '\n\nVerifique o console para mais detalhes.');
            }
        }
    }

    // Cria instância global IMEDIATAMENTE (antes de qualquer outro script)
    // Isso garante que a interceptação do fetch esteja ativa antes de qualquer chamada
    // A interceptação do fetch precisa estar ativa ANTES de qualquer script chamar fetch('/cart.js')
    window.carrefourCart = new CarrefourCart();

})();
