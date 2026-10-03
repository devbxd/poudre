const woosbCheckoutFilters = window.wc.blocksCheckout.registerCheckoutFilters;

const woosbCartItemClass = (defaultValue, extensions, args) => {
    const isCartContext = args?.context === 'cart' || args?.context === 'summary';

    if (!isCartContext) {
        return defaultValue;
    }

    if (args?.cartItem?.woosb_bundles) {
        defaultValue += ' woosb-bundles';
    }

    if (args?.cartItem?.woosb_bundled) {
        defaultValue += ' woosb-bundled';
    }

    if (args?.cartItem?.woosb_hide_bundled) {
        defaultValue += ' woosb-hide-bundled';
    }

    if (args?.cartItem?.woosb_fixed_price) {
        defaultValue += ' woosb-fixed-price';
    }

    return defaultValue;
};

const woosbShowRemoveItemLink = (defaultValue, extensions, args) => {
    const isCartContext = args?.context === 'cart';

    if (!isCartContext) {
        return defaultValue;
    }

    if (args?.cartItem?.woosb_bundled) {
        return false;
    }

    return defaultValue;
};

const woosbCartItemPrice = (defaultValue, extensions, args, validation) => {
    const isCartContext = args?.context === 'cart' || args?.context === 'summary';

    if (!isCartContext) {
        return defaultValue;
    }

    if (args?.cartItem?.woosb_bundles && args?.cartItem?.woosb_price) {
        return woosb_format_price(args?.cartItem?.woosb_price * args?.cartItem?.quantity).replace(/<[^>]*>?/gm, '') + '<price/>';
    }

    return '<price/>';
};

const woosbSubtotalPriceFormat = (defaultValue, extensions, args, validation) => {
    const isCartContext = args?.context === 'cart' || args?.context === 'summary';

    if (!isCartContext) {
        return defaultValue;
    }

    if (args?.cartItem?.woosb_bundles && args?.cartItem?.woosb_price) {
        return woosb_format_price(args?.cartItem?.woosb_price).replace(/<[^>]*>?/gm, '') + '<price/>';
    }

    return '<price/>';
};

const woosbItemName = (defaultValue, extensions, args) => {
    const isCartContext = args?.context === 'cart';

    if (!isCartContext) {
        return defaultValue;
    }

    // Append edit link after the product name when woosb_edit_url is available
    if (args?.cartItem?.woosb_edit_url) {
        const label = extensions?.['woosb-blocks']?.edit_label || 'Edit';

        return defaultValue + ' <a class="woosb-cart-item-edit" href="' + args.cartItem.woosb_edit_url + '">' + label + '</a>';
    }

    return defaultValue;
};

woosbCheckoutFilters('woosb-blocks', {
    cartItemClass: woosbCartItemClass,
    showRemoveItemLink: woosbShowRemoveItemLink,
    cartItemPrice: woosbCartItemPrice,
    subtotalPriceFormat: woosbSubtotalPriceFormat,
    itemName: woosbItemName,
});

// https://github.com/woocommerce/woocommerce-blocks/blob/trunk/docs/third-party-developers/extensibility/checkout-block/available-filters/cart-line-items.md

// Suppress Cart Block child removal/change notices via MutationObserver
( function () {
    const selector = '.wc-block-components-notice-snackbar, .wc-block-components-notice-banner';
    let queued = false;

    function hideChildNotices() {
        queued = false;
        document.querySelectorAll( selector ).forEach( function ( el ) {
            const text = el.textContent || '';
            if ( text.indexOf( '\u200B' ) !== -1 ) {
                el.style.display = 'none';
            }
        } );
    }

    if ( typeof MutationObserver !== 'undefined' ) {
        new MutationObserver( function () {
            if ( ! queued ) {
                queued = true;
                requestAnimationFrame( hideChildNotices );
            }
        } ).observe( document.body, { childList: true, subtree: true, characterData: true } );
    }
} )();
