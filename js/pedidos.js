/**
 * Módulo de Gestión de Pedidos
 * ==============================
 * Funciones auxiliares para manejar pedidos del cliente
 */

const PedidosHelper = {
    /**
     * Valida un pedido antes de enviar
     * @param {Object} pedido - Datos del pedido
     * @returns {Object} { valid: boolean, error: string }
     */
    validarPedido(pedido) {
        if (!pedido.cliente || pedido.cliente.trim() === '') {
            return { valid: false, error: 'El nombre del cliente es requerido' };
        }

        if (pedido.cliente.length < 2) {
            return { valid: false, error: 'El nombre debe tener al menos 2 caracteres' };
        }

        if (!pedido.productos || pedido.productos.length === 0) {
            return { valid: false, error: 'El pedido debe contener al menos un producto' };
        }

        if (!pedido.tiempo_llegada) {
            return { valid: false, error: 'Debe seleccionar un tiempo de llegada' };
        }

        if (!pedido.metodo_pago) {
            return { valid: false, error: 'Debe seleccionar un método de pago' };
        }

        if (pedido.total <= 0) {
            return { valid: false, error: 'El total del pedido debe ser mayor a cero' };
        }

        return { valid: true };
    },

    /**
     * Verifica que haya stock suficiente para un pedido
     * @param {Array} productosCarrito - Productos en el carrito
     * @param {Array} productosDB - Productos desde la base de datos
     * @returns {Object} { valid: boolean, error: string, producto: string }
     */
    verificarStock(productosCarrito, productosDB) {
        for (const item of productosCarrito) {
            const producto = productosDB.find(p => p.id === item.id);

            if (!producto) {
                return {
                    valid: false,
                    error: 'Producto no encontrado',
                    producto: item.nombre
                };
            }

            if (producto.stock < item.cantidad) {
                return {
                    valid: false,
                    error: `Stock insuficiente. Disponible: ${producto.stock}`,
                    producto: item.nombre
                };
            }
        }

        return { valid: true };
    },

    /**
     * Formatea un pedido para enviar a la base de datos
     * @param {Object} datosFormulario - Datos del formulario
     * @param {Array} carrito - Items del carrito
     * @param {number} total - Total del pedido
     * @returns {Object} Pedido formateado
     */
    formatearPedido(datosFormulario, carrito, total) {
        return {
            cliente: datosFormulario.cliente.trim(),
            tiempo_llegada: datosFormulario.tiempo_llegada,
            metodo_pago: datosFormulario.metodo_pago,
            productos: carrito.map(item => ({
                id: item.id,
                nombre: item.nombre,
                cantidad: item.cantidad,
                precio: item.precio
            })),
            total: total
        };
    },

    /**
     * Formatea la fecha y hora para mostrar
     * @param {string} timestamp - ISO timestamp
     * @returns {string} Fecha formateada
     */
    formatearFecha(timestamp) {
        const fecha = new Date(timestamp);
        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        return fecha.toLocaleString('es-MX', options);
    },

    /**
     * Formatea una lista de productos para mostrar
     * @param {Array} productos - Array de productos
     * @returns {string} Texto formateado
     */
    formatearProductosTexto(productos) {
        return productos.map(p => `${p.cantidad}x ${p.nombre}`).join(', ');
    },

    /**
     * Genera un resumen del pedido para notificación
     * @param {Object} pedido - Objeto del pedido
     * @returns {string} Resumen del pedido
     */
    generarResumenPedido(pedido) {
        const cantidad = pedido.productos.reduce((sum, p) => sum + p.cantidad, 0);
        return `${pedido.cliente} • ${cantidad} artículo${cantidad > 1 ? 's' : ''} • ${this.formatCurrency(pedido.total)}`;
    },

    /**
     * Formatea un número como moneda
     * @param {number} amount - Cantidad
     * @returns {string} Moneda formateada
     */
    formatCurrency(amount) {
        return new Intl.NumberFormat(CONFIG.UI.CURRENCY_LOCALE, {
            style: 'currency',
            currency: CONFIG.UI.CURRENCY
        }).format(amount);
    }
};

// Hacer disponible globalmente
window.PedidosHelper = PedidosHelper;
