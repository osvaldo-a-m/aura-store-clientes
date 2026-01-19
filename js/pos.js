/**
 * Controlador del Módulo POS
 * ==========================
 * Maneja toda la lógica del punto de venta:
 * - Gestión del carrito
 * - Alta de productos
 * - Búsqueda y sugerencias
 * - Integración con scanner
 * - Procesamiento de ventas
 */

class POS {
    constructor() {
        this.carrito = [];
        this.productos = [];
        this.initialized = false;
        this.selectedImageFile = null;
    }

    /**
     * Inicializa el sistema POS
     */
    async init() {
        if (this.initialized) return;

        // Inicializar base de datos
        await database.init();
        this.updateConnectionStatus();

        // Cargar productos
        await this.cargarProductos();

        // Cargar y suscribirse a pedidos
        await this.cargarPedidosPendientes();
        this.suscribirPedidos();

        // Configurar navegación por pestañas
        this.setupTabNavigation();

        // Configurar listeners de eventos
        this.setupEventListeners();

        // Inicializar scanner de códigos
        BarcodeScanner.init(this.onBarcodeScanned.bind(this));

        // Suscribirse a cambios en tiempo real
        database.onDataChange(this.onDatabaseChange.bind(this));

        this.initialized = true;
        console.log('✅ Sistema POS inicializado');
    }

    // ==========================================
    // GESTIÓN DE PRODUCTOS
    // ==========================================

    /**
     * Carga todos los productos del inventario
     */
    async cargarProductos() {
        try {
            this.productos = await database.getProductos();
            this.renderTablaProductos();
        } catch (error) {
            console.error('Error al cargar productos:', error);
            this.showNotification('Error al cargar productos', 'error');
        }
    }

    /**
     * Renderiza la tabla de productos
     */
    renderTablaProductos() {
        const tbody = document.getElementById('tabla-productos');

        if (this.productos.length === 0) {
            tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: var(--space-8); color: var(--color-text-muted);">
            <p style="font-size: var(--text-3xl); margin-bottom: var(--space-2);">📦</p>
            <p>No hay productos en el inventario</p>
            <p style="font-size: var(--text-sm); margin-top: var(--space-2);">
              Agrega tu primer producto usando el formulario arriba
            </p>
          </td>
        </tr>
      `;
            return;
        }

        tbody.innerHTML = this.productos.map(producto => {
            const stockClass = producto.stock <= 5 ? 'stock-low' :
                producto.stock <= 20 ? 'stock-medium' :
                    'stock-high';

            // Generar thumbnail de imagen o emoji de fallback
            const imageCell = producto.imagen_url
                ? `<img src="${producto.imagen_url}" alt="${producto.nombre}" class="product-thumbnail" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                   <span class="product-emoji" style="display:none;">${this.getProductEmoji(producto.nombre)}</span>`
                : `<span class="product-emoji">${this.getProductEmoji(producto.nombre)}</span>`;

            return `
        <tr>
          <td class="product-image-cell">${imageCell}</td>
          <td><code>${producto.codigo_barras}</code></td>
          <td><strong>${producto.nombre}</strong></td>
          <td>${this.formatCurrency(producto.precio)}</td>
          <td class="${stockClass}">${producto.stock} uds</td>
        </tr>
      `;
        }).join('');
    }

    /**
     * Agrega un nuevo producto al inventario
     */
    async agregarProducto(event) {
        event.preventDefault();

        const nombre = document.getElementById('input-nombre').value.trim();
        const codigo = document.getElementById('input-codigo').value.trim();
        const precio = parseFloat(document.getElementById('input-precio').value);
        const stock = parseInt(document.getElementById('input-stock').value);

        // Validaciones
        if (!nombre || !codigo || isNaN(precio) || isNaN(stock)) {
            this.showNotification('Por favor completa todos los campos correctamente', 'warning');
            return;
        }

        if (precio < CONFIG.VALIDATION.MIN_PRICE || precio > CONFIG.VALIDATION.MAX_PRICE) {
            this.showNotification('El precio debe estar entre $0.01 y $999,999.99', 'warning');
            return;
        }

        // Verificar si el código ya existe
        const existente = this.productos.find(p => p.codigo_barras === codigo);
        if (existente) {
            this.showNotification('Ya existe un producto con ese código de barras', 'warning');
            return;
        }

        try {
            let imagen_url = null;

            // Si hay una imagen seleccionada, subirla primero
            if (this.selectedImageFile) {
                this.showNotification('📤 Subiendo imagen...', 'info');
                try {
                    imagen_url = await database.uploadProductImage(this.selectedImageFile);
                } catch (uploadError) {
                    console.error('Error al subir imagen:', uploadError);
                    this.showNotification(`⚠️ Error al subir imagen: ${uploadError.message}`, 'warning');
                    // Continuar sin imagen
                }
            }

            const nuevoProducto = await database.addProducto({
                nombre,
                codigo_barras: codigo,
                precio,
                stock,
                imagen_url
            });

            this.productos.push(nuevoProducto);
            this.renderTablaProductos();

            // Limpiar formulario e imagen
            document.getElementById('form-producto').reset();
            this.clearImagePreview();

            this.showNotification(`✅ Producto "${nombre}" agregado exitosamente`, 'success');
        } catch (error) {
            console.error('Error al agregar producto:', error);
            this.showNotification('Error al agregar producto. Intenta nuevamente.', 'error');
        }
    }

    // ==========================================
    // GESTIÓN DEL CARRITO
    // ==========================================

    /**
     * Agrega un producto al carrito
     */
    agregarAlCarrito(producto) {
        // Verificar stock disponible
        if (producto.stock <= 0) {
            this.showNotification(`⚠️ "${producto.nombre}" está agotado`, 'warning');
            return;
        }

        // Buscar si ya está en el carrito
        const itemExistente = this.carrito.find(item => item.producto.id === producto.id);

        if (itemExistente) {
            // Verificar que no excedamos el stock
            if (itemExistente.cantidad >= producto.stock) {
                this.showNotification(`⚠️ No hay más stock disponible de "${producto.nombre}"`, 'warning');
                return;
            }
            itemExistente.cantidad++;
        } else {
            this.carrito.push({
                producto: producto,
                cantidad: 1
            });
        }

        this.renderCarrito();
        this.showNotification(`➕ "${producto.nombre}" agregado al carrito`, 'success');

        // Animación flash en el carrito
        const cartElement = document.querySelector('.pos-cart');
        cartElement.classList.add('scanner-active');
        setTimeout(() => cartElement.classList.remove('scanner-active'), 1000);
    }

    /**
     * Elimina un producto del carrito (una unidad a la vez)
     */
    eliminarDelCarrito(index) {
        const item = this.carrito[index];

        if (item.cantidad > 1) {
            // Si hay más de 1, solo reducir cantidad
            item.cantidad--;
            this.renderCarrito();
            this.showNotification(`➖ Una unidad de "${item.producto.nombre}" eliminada`, 'success');
        } else {
            // Si solo hay 1, eliminar completamente
            this.carrito.splice(index, 1);
            this.renderCarrito();
            this.showNotification(`🗑️ "${item.producto.nombre}" eliminado del carrito`, 'success');
        }
    }

    /**
     * Incrementa la cantidad de un producto en el carrito
     */
    incrementarEnCarrito(index) {
        const item = this.carrito[index];

        // Verificar que no excedamos el stock
        if (item.cantidad >= item.producto.stock) {
            this.showNotification(`⚠️ No hay más stock disponible de "${item.producto.nombre}"`, 'warning');
            return;
        }

        item.cantidad++;
        this.renderCarrito();
        this.showNotification(`➕ Una unidad de "${item.producto.nombre}" agregada`, 'success');
    }

    /**
     * Limpia todo el carrito
     */
    limpiarCarrito() {
        if (this.carrito.length === 0) return;

        if (confirm('¿Estás seguro de limpiar el carrito?')) {
            this.carrito = [];
            this.renderCarrito();
            this.showNotification('🗑️ Carrito limpiado', 'success');
        }
    }

    /**
     * Renderiza el carrito
     */
    renderCarrito() {
        const cartItems = document.getElementById('cart-items');
        const cartTotal = document.getElementById('cart-total');
        const btnFinalizar = document.getElementById('btn-finalizar-venta');
        const btnLimpiar = document.getElementById('btn-limpiar-carrito');

        if (this.carrito.length === 0) {
            cartItems.innerHTML = `
        <div class="cart-empty">
          <p style="font-size: var(--text-3xl); margin-bottom: var(--space-2);">🛍️</p>
          <p>No hay productos en el carrito</p>
          <p style="font-size: var(--text-xs); margin-top: var(--space-2);">
            Escanea o busca productos para agregar
          </p>
        </div>
      `;
            cartTotal.textContent = this.formatCurrency(0);
            btnFinalizar.disabled = true;
            btnLimpiar.disabled = true;
            return;
        }

        // Renderizar items
        cartItems.innerHTML = this.carrito.map((item, index) => {
            const subtotal = item.producto.precio * item.cantidad;
            const maxStock = item.producto.stock;
            const atMaxStock = item.cantidad >= maxStock;

            return `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-name">${item.producto.nombre}</div>
            <div class="cart-item-price-unit">${this.formatCurrency(item.producto.precio)} c/u</div>
          </div>
          <div class="cart-item-controls">
            <button class="btn-decrementar" data-index="${index}" title="Quitar una unidad">
              ➖
            </button>
            <div class="cart-item-cantidad-display">
              <span class="cantidad-numero">${item.cantidad}</span>
              <span class="cantidad-label">uds</span>
            </div>
            <button class="btn-incrementar" data-index="${index}" title="Agregar una unidad" ${atMaxStock ? 'disabled' : ''}>
              ➕
            </button>
            <button class="btn-eliminar" data-index="${index}" title="Eliminar del carrito">
              🗑️
            </button>
          </div>
          <div class="cart-item-subtotal">${this.formatCurrency(subtotal)}</div>
        </div>
      `;
        }).join('');

        // Calcular total
        const total = this.carrito.reduce((sum, item) => {
            return sum + (item.producto.precio * item.cantidad);
        }, 0);

        cartTotal.textContent = this.formatCurrency(total);
        btnFinalizar.disabled = false;
        btnLimpiar.disabled = false;

        // Event listeners para los botones del carrito
        // Botón decrementar (-)
        document.querySelectorAll('.btn-decrementar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.eliminarDelCarrito(index);
            });
        });

        // Botón incrementar (+)
        document.querySelectorAll('.btn-incrementar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.incrementarEnCarrito(index);
            });
        });

        // Botón eliminar (🗑️)
        document.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                // Eliminar completamente del carrito
                this.carrito.splice(index, 1);
                this.renderCarrito();
                this.showNotification('🗑️ Producto eliminado del carrito', 'success');
            });
        });
    }

    /**
     * Finaliza la venta con selección de método de pago
     */
    async finalizarVenta() {
        if (this.carrito.length === 0) return;

        // Calcular total
        const total = this.carrito.reduce((sum, item) => {
            return sum + (item.producto.precio * item.cantidad);
        }, 0);

        // Mostrar selector de método de pago
        const metodoPago = await this.mostrarSelectorPago(total);
        if (!metodoPago) return; // Usuario canceló

        try {
            // Actualizar stock de cada producto
            for (const item of this.carrito) {
                const nuevoStock = item.producto.stock - item.cantidad;
                await database.updateStock(item.producto.id, nuevoStock);

                // Actualizar en la lista local
                const producto = this.productos.find(p => p.id === item.producto.id);
                if (producto) {
                    producto.stock = nuevoStock;
                }
            }

            // Crear registro de venta
            await database.createVenta({
                pedido_id: null, // Venta directa sin pedido
                total: total,
                metodo_pago: metodoPago,
                productos: this.carrito.map(item => ({
                    id: item.producto.id,
                    nombre: item.producto.nombre,
                    cantidad: item.cantidad,
                    precio: item.producto.precio
                }))
            });

            this.showNotification(
                `✅ Venta completada por ${this.formatCurrency(total)}`,
                'success'
            );

            // Limpiar carrito y actualizar vista
            this.carrito = [];
            this.renderCarrito();
            this.renderTablaProductos();

        } catch (error) {
            console.error('Error al finalizar venta:', error);
            this.showNotification('❌ Error al procesar la venta', 'error');
        }
    }

    /**
     * Muestra el selector de método de pago
     * @returns {Promise<string|null>} Método de pago seleccionado o null si canceló
     */
    mostrarSelectorPago(total) {
        return new Promise((resolve) => {
            // Crear modal
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-payment">
                    <div class="modal-header">
                        <h2>💳 Método de Pago</h2>
                        <p style="color: var(--color-text-muted); margin-top: var(--space-2);">
                            Total: ${this.formatCurrency(total)}
                        </p>
                    </div>
                    <div class="modal-body">
                        <div class="payment-options">
                            <button class="payment-option" data-method="efectivo">
                                <span class="payment-icon">💵</span>
                                <span class="payment-label">Efectivo</span>
                            </button>
                            <button class="payment-option" data-method="tarjeta">
                                <span class="payment-icon">💳</span>
                                <span class="payment-label">Tarjeta</span>
                            </button>
                            <button class="payment-option" data-method="transferencia">
                                <span class="payment-icon">🏦</span>
                                <span class="payment-label">Transferencia</span>
                            </button>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" id="btn-cancel-payment">Cancelar</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Event listeners
            modal.querySelectorAll('.payment-option').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const method = btn.dataset.method;

                    if (method === 'transferencia') {
                        // Mostrar datos de transferencia
                        this.mostrarDatosTransferencia(total);
                        modal.remove();
                        resolve('transferencia');
                    } else {
                        // Efectivo o tarjeta: proceder directamente
                        modal.remove();
                        resolve(method);
                    }
                });
            });

            document.getElementById('btn-cancel-payment').addEventListener('click', () => {
                modal.remove();
                resolve(null);
            });

            // Click fuera del modal para cerrar
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(null);
                }
            });
        });
    }

    /**
     * Muestra ventana con datos de transferencia bancaria
     */
    mostrarDatosTransferencia(total) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-transfer">
                <div class="modal-header">
                    <h2>🏦 Datos para Transferencia</h2>
                    <p style="color: var(--color-text-muted); margin-top: var(--space-2);">
                        Total a pagar: ${this.formatCurrency(total)}
                    </p>
                </div>
                <div class="modal-body">
                    <div class="transfer-info">
                        <div class="transfer-row">
                            <strong>Banco:</strong>
                            <span>BBVA Bancomer</span>
                        </div>
                        <div class="transfer-row">
                            <strong>Titular:</strong>
                            <span>Aura Store</span>
                        </div>
                        <div class="transfer-row">
                            <strong>CLABE:</strong>
                            <span class="highlight">012180001234567890</span>
                        </div>
                        <div class="transfer-row">
                            <strong>Cuenta:</strong>
                            <span class="highlight">0123456789</span>
                        </div>
                        <div class="transfer-row">
                            <strong>Concepto:</strong>
                            <span>Venta POS - ${new Date().toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="transfer-note">
                        <p><strong>📝 Importante:</strong></p>
                        <p>Envía el comprobante de pago para completar la transacción.</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="btn-close-transfer">Entendido</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('btn-close-transfer').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // ==========================================
    // BÚSQUEDA Y SUGERENCIAS
    // ==========================================

    /**
     * Busca productos por nombre
     */
    buscarProductos(query) {
        // No mostrar sugerencias si se está escaneando
        if (BarcodeScanner.isScanning) {
            return;
        }

        if (!query || query.length < 2) {
            this.hideSuggestions();
            return;
        }

        const resultados = this.productos.filter(producto =>
            producto.nombre.toLowerCase().includes(query.toLowerCase()) ||
            producto.codigo_barras.includes(query)
        ).slice(0, 5); // Máximo 5 resultados

        this.showSuggestions(resultados);
    }

    /**
     * Muestra sugerencias de búsqueda
     */
    showSuggestions(productos) {
        const container = document.getElementById('producto-suggestions');

        if (productos.length === 0) {
            this.hideSuggestions();
            return;
        }

        container.innerHTML = productos.map(producto => `
      <div class="suggestion-item" data-producto-id="${producto.id}">
        <div>
          <div style="font-weight: 600;">${producto.nombre}</div>
          <div style="font-size: var(--text-xs); color: var(--color-text-muted);">
            ${producto.codigo_barras} • Stock: ${producto.stock}
          </div>
        </div>
        <div style="font-weight: 700; color: var(--color-primary-light);">
          ${this.formatCurrency(producto.precio)}
        </div>
      </div>
    `).join('');

        container.classList.remove('hidden');

        // Event listeners
        container.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const productoId = item.dataset.productoId;
                const producto = this.productos.find(p => p.id === productoId);
                if (producto) {
                    this.agregarAlCarrito(producto);
                    document.getElementById('buscar-producto').value = '';
                    this.hideSuggestions();
                }
            });
        });
    }

    /**
     * Oculta sugerencias
     */
    hideSuggestions() {
        const container = document.getElementById('producto-suggestions');
        container.classList.add('hidden');
        container.innerHTML = '';
    }

    // ==========================================
    // INTEGRACIÓN CON SCANNER
    // ==========================================


    /**
     * Callback cuando se escanea un código de barras
     */
    async onBarcodeScanned(codigo) {
        console.log('🔍 Buscando producto con código:', codigo);

        // Limpiar campo de búsqueda y ocultar sugerencias
        const buscarInput = document.getElementById('buscar-producto');
        if (buscarInput) {
            buscarInput.value = '';
        }
        this.hideSuggestions();

        // Buscar y agregar producto
        const producto = await database.getProductoPorCodigo(codigo);

        if (producto) {
            this.agregarAlCarrito(producto);
        } else {
            this.showNotification(`❌ No se encontró producto con código: ${codigo}`, 'error');
        }
    }


    // ==========================================
    // EVENTOS Y UTILIDADES
    // ==========================================

    /**
     * Configura los event listeners
     */
    setupEventListeners() {
        // Formulario de producto
        document.getElementById('form-producto').addEventListener('submit',
            this.agregarProducto.bind(this));

        // Búsqueda de productos
        const buscarInput = document.getElementById('buscar-producto');
        buscarInput.addEventListener('input', (e) => {
            this.buscarProductos(e.target.value);
        });

        // Ocultar sugerencias al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.buscar-producto-input')) {
                this.hideSuggestions();
            }
        });

        // Botones del carrito
        document.getElementById('btn-finalizar-venta').addEventListener('click',
            this.finalizarVenta.bind(this));

        document.getElementById('btn-limpiar-carrito').addEventListener('click',
            this.limpiarCarrito.bind(this));

        // Image upload handlers
        this.setupImageHandlers();
    }

    /**
     * Maneja cambios en la base de datos en tiempo real
     */
    async onDatabaseChange(change) {
        console.log('🔄 Cambio en base de datos:', change);
        await this.cargarProductos();
    }

    /**
     * Actualiza el estado de conexión en la UI
     */
    updateConnectionStatus() {
        const statusElement = document.getElementById('connection-status');
        const statusText = document.getElementById('status-text');
        const isOnline = database.isOnline;

        if (isOnline) {
            statusElement.classList.remove('offline');
            statusElement.classList.add('online');
            statusText.textContent = 'En línea';
            statusElement.querySelector('.status-dot').classList.remove('offline');
            statusElement.querySelector('.status-dot').classList.add('online');
        } else {
            statusElement.classList.remove('online');
            statusElement.classList.add('offline');
            statusText.textContent = 'Modo Offline';
            statusElement.querySelector('.status-dot').classList.remove('online');
            statusElement.querySelector('.status-dot').classList.add('offline');
        }
    }

    /**
     * Muestra una notificación
     */
    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, CONFIG.UI.NOTIFICATION_DURATION);
    }

    /**
     * Formatea un número como moneda
     */
    formatCurrency(amount) {
        return new Intl.NumberFormat(CONFIG.UI.CURRENCY_LOCALE, {
            style: 'currency',
            currency: CONFIG.UI.CURRENCY
        }).format(amount);
    }

    /**
     * Obtiene un emoji apropiado para el producto
     */
    getProductEmoji(nombre) {
        const lower = nombre.toLowerCase();

        // Bebidas
        if (lower.includes('coca') || lower.includes('refresco') || lower.includes('soda')) return '🥤';
        if (lower.includes('agua') || lower.includes('mineral')) return '💧';
        if (lower.includes('cerveza') || lower.includes('beer')) return '🍺';
        if (lower.includes('vino') || lower.includes('wine')) return '🍷';
        if (lower.includes('jugo') || lower.includes('juice')) return '🧃';
        if (lower.includes('leche') || lower.includes('milk')) return '🥛';
        if (lower.includes('café') || lower.includes('coffee')) return '☕';

        // Alimentos
        if (lower.includes('pan') || lower.includes('bread')) return '🍞';
        if (lower.includes('galleta') || lower.includes('cookie')) return '🍪';
        if (lower.includes('chocolate') || lower.includes('dulce')) return '🍫';
        if (lower.includes('papas') || lower.includes('chips')) return '🥔';

        // Default
        return CONFIG.IMAGES.DEFAULT_PLACEHOLDER;
    }

    // ==========================================
    // GESTIÓN DE PEDIDOS
    // ==========================================

    /**
     * Carga y muestra los pedidos pendientes
     */
    async cargarPedidosPendientes() {
        try {
            const pedidos = await database.getPedidosPendientes();
            this.renderPedidos(pedidos);
        } catch (error) {
            console.error('Error al cargar pedidos:', error);
        }
    }

    /**
     * Renderiza la lista de pedidos pendientes
     */
    renderPedidos(pedidos) {
        const container = document.getElementById('pedidos-container');

        if (!pedidos || pedidos.length === 0) {
            container.innerHTML = `
                <div class="pedidos-empty">
                    <p style="font-size: var(--text-2xl); margin-bottom: var(--space-2);">📭</p>
                    <p>No hay pedidos pendientes</p>
                    <p style="font-size: var(--text-sm); margin-top: var(--space-2); opacity: 0.7;">
                        Los pedidos del catálogo público aparecerán aquí
                    </p>
                </div>
            `;
            return;
        }

        container.innerHTML = pedidos.map(pedido => this.renderPedidoCard(pedido)).join('');

        // Añadir event listeners a los botones
        document.querySelectorAll('.btn-confirmar-entrega').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pedidoId = e.target.dataset.pedidoId;
                this.confirmarEntrega(pedidoId);
            });
        });
    }

    /**
     * Renderiza una tarjeta de pedido
     */
    renderPedidoCard(pedido) {
        const fecha = PedidosHelper.formatearFecha(pedido.created_at);
        const productos = PedidosHelper.formatearProductosTexto(pedido.productos);
        const total = this.formatCurrency(pedido.total);

        return `
            <div class="pedido-card" data-id="${pedido.id}">
                <div class="pedido-header">
                    <div>
                        <h3>👤 ${pedido.cliente}</h3>
                        <p class="pedido-fecha">${fecha}</p>
                    </div>
                    <div class="pedido-total">${total}</div>
                </div>
                <div class="pedido-body">
                    <div class="pedido-info-row">
                        <strong>📦 Productos:</strong>
                        <span>${productos}</span>
                    </div>
                    <div class="pedido-info-row">
                        <strong>⏱️ Llegada:</strong>
                        <span>${pedido.tiempo_llegada}</span>
                    </div>
                    <div class="pedido-info-row">
                        <strong>💳 Pago:</strong>
                        <span>${pedido.metodo_pago === 'transferencia' ? 'Transferencia Bancaria' : 'Efectivo en tienda'}</span>
                    </div>
                </div>
                <div class="pedido-footer">
                    <button class="btn btn-success btn-confirmar-entrega" data-pedido-id="${pedido.id}">
                        ✅ Confirmar Entrega
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Suscribe a nuevos pedidos en tiempo real
     */
    suscribirPedidos() {
        database.subscribeToPedidos((pedido) => {
            console.log('🔔 Nuevo pedido recibido:', pedido);

            // Reproducir sonido (opcional)
            if (CONFIG.NOTIFICACIONES.SOUND_ENABLED) {
                this.playNotificationSound();
            }

            // Mostrar notificación toast
            this.mostrarNotificacionPedido(pedido);

            // Recargar lista de pedidos
            this.cargarPedidosPendientes();
        });
    }

    /**
     * Muestra notificación de nuevo pedido
     */
    mostrarNotificacionPedido(pedido) {
        const resumen = PedidosHelper.generarResumenPedido(pedido);
        const toast = document.createElement('div');
        toast.className = 'toast toast-pedido';
        toast.innerHTML = `
            <div class="toast-icon">🔔</div>
            <div class="toast-content">
                <strong>¡Nuevo Pedido!</strong>
                <p>${resumen}</p>
            </div>
        `;

        const container = document.getElementById('toast-container');
        if (container) {
            container.appendChild(toast);

            // Mostrar
            setTimeout(() => toast.classList.add('show'), 10);

            // Ocultar y remover
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, CONFIG.NOTIFICACIONES.DURACION);
        }
    }

    /**
     * Reproduce sonido de notificación (opcional)
     */
    playNotificationSound() {
        try {
            // Simple beep usando Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.log('No se pudo reproducir sonido:', error);
        }
    }

    /**
     * Confirma la entrega de un pedido
     */
    async confirmarEntrega(pedidoId) {
        try {
            // Buscar el pedido
            const pedidos = await database.getPedidosPendientes();
            const pedido = pedidos.find(p => p.id === pedidoId);

            if (!pedido) {
                this.showNotification('Pedido no encontrado', 'error');
                return;
            }

            // Confirmar con el usuario
            if (!confirm(`¿Confirmar entrega del pedido de ${pedido.cliente}?`)) {
                return;
            }

            // Deshabilitar botón
            const btn = document.querySelector(`[data-pedido-id="${pedidoId}"]`);
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Procesando...';
            }

            // 1. Reducir inventario
            const actualizaciones = pedido.productos.map(item => ({
                id: item.id,
                cantidad: item.cantidad
            }));

            await database.updateMultipleStock(actualizaciones);

            // 2. Crear registro de venta
            await database.createVenta({
                pedido_id: pedido.id,
                total: pedido.total,
                metodo_pago: pedido.metodo_pago,
                productos: pedido.productos
            });

            // 3. Actualizar estado del pedido
            await database.updatePedidoEstado(pedido.id, 'completado');

            // 4. Actualizar UI
            this.showNotification('✅ Pedido completado exitosamente', 'success');
            await this.cargarPedidosPendientes();
            await this.cargarProductos(); // Actualizar tabla de inventario

        } catch (error) {
            console.error('Error al confirmar entrega:', error);
            this.showNotification('Error al procesar el pedido', 'error');

            // Rehabilitar botón
            const btn = document.querySelector(`[data-pedido-id="${pedidoId}"]`);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '✅ Confirmar Entrega';
            }
        }
    }

    // ==========================================
    // MANEJO DE IMÁGENES
    // ==========================================

    /**
     * Configura los event listeners para manejo de imágenes
     */
    setupImageHandlers() {
        const inputImagen = document.getElementById('input-imagen');
        const btnRemoveImagen = document.getElementById('btn-remove-imagen');

        if (inputImagen) {
            inputImagen.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleImageSelection(file);
                }
            });
        }

        if (btnRemoveImagen) {
            btnRemoveImagen.addEventListener('click', () => {
                this.clearImagePreview();
            });
        }
    }

    /**
     * Maneja la selección de una imagen
     */
    handleImageSelection(file) {
        // Validar tipo
        if (!CONFIG.IMAGES.ALLOWED_TYPES.includes(file.type)) {
            this.showNotification(
                `Tipo de archivo no válido. Use: ${CONFIG.IMAGES.ALLOWED_EXTENSIONS.join(', ')}`,
                'warning'
            );
            return;
        }

        // Validar tamaño
        if (file.size > CONFIG.IMAGES.MAX_FILE_SIZE) {
            const maxSizeMB = CONFIG.IMAGES.MAX_FILE_SIZE / (1024 * 1024);
            this.showNotification(
                `El archivo es demasiado grande. Tamaño máximo: ${maxSizeMB}MB`,
                'warning'
            );
            return;
        }

        // Guardar archivo
        this.selectedImageFile = file;

        // Mostrar vista previa
        this.showImagePreview(file);
    }

    /**
     * Muestra la vista previa de la imagen
     */
    showImagePreview(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('imagen-preview');
            const container = document.getElementById('imagen-preview-container');

            if (preview && container) {
                preview.src = e.target.result;
                container.style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
    }

    /**
     * Limpia la vista previa de imagen
     */
    clearImagePreview() {
        this.selectedImageFile = null;
        const inputImagen = document.getElementById('input-imagen');
        const preview = document.getElementById('imagen-preview');
        const container = document.getElementById('imagen-preview-container');

        if (inputImagen) inputImagen.value = '';
        if (preview) preview.src = '';
        if (container) container.style.display = 'none';
    }


    // ==========================================
    // NAVEGACIÓN POR PESTAÑAS
    // ==========================================

    /**
     * Configura la navegación por pestañas
     */
    setupTabNavigation() {
        const tabButtons = document.querySelectorAll('.tab-btn');

        // Event listeners para cada botón
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const viewName = btn.dataset.view;
                this.cambiarVista(viewName);
            });
        });

        // Restaurar última vista activa
        const lastView = localStorage.getItem('pos_active_view') || 'ventas';
        this.cambiarVista(lastView, false); // false = no guardar en localStorage otra vez
    }

    /**
     * Cambia entre vistas (ventas/inventario)
     * @param {string} viewName - Nombre de la vista ('ventas' o 'inventario')
     * @param {boolean} saveToStorage - Si debe guardar en localStorage (default: true)
     */
    cambiarVista(viewName, saveToStorage = true) {
        // Ocultar todas las vistas
        document.querySelectorAll('.vista-container').forEach(vista => {
            vista.classList.remove('active');
        });

        // Desactivar todos los botones
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Activar vista seleccionada
        const vistaActiva = document.getElementById(`vista-${viewName}`);
        if (vistaActiva) {
            vistaActiva.classList.add('active');
        }

        // Activar botón correspondiente
        const btnActivo = document.querySelector(`[data-view="${viewName}"]`);
        if (btnActivo) {
            btnActivo.classList.add('active');
        }

        // Guardar preferencia en localStorage
        if (saveToStorage) {
            localStorage.setItem('pos_active_view', viewName);
            console.log(`📋 Vista cambiada a: ${viewName}`);
        }
    }
}

// ==========================================
// INICIALIZACIÓN
// ==========================================
const pos = new POS();

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => pos.init());
} else {
    pos.init();
}

// Exportar para uso global
window.pos = pos;
