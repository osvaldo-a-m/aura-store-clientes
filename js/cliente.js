/**
 * Controlador del Catálogo Público
 * =================================
 * Muestra los productos disponibles para los clientes
 * con sincronización en tiempo real y carrito de compras.
 */

class CatalogoCliente {
  constructor() {
    this.productos = [];
    this.carrito = [];
    this.initialized = false;
  }

  /**
   * Inicializa el catálogo
   */
  async init() {
    if (this.initialized) return;

    // Cargar carrito desde localStorage
    this.cargarCarrito();

    // Inicializar base de datos
    await database.init();

    // Cargar productos
    await this.cargarProductos();

    // Suscribirse a cambios en tiempo real
    database.onDataChange(this.onDatabaseChange.bind(this));

    // Configurar event listeners
    this.setupEventListeners();

    // Actualizar UI del carrito
    this.renderCarrito();

    this.initialized = true;
    console.log('✅ Catálogo público inicializado');
  }

  /**
   * Carga todos los productos (solo con stock > 0)
   */
  async cargarProductos() {
    try {
      const todosProductos = await database.getProductos();
      // Filtrar solo productos con stock disponible
      this.productos = todosProductos.filter(p => p.stock > 0);
      this.renderProductos();
    } catch (error) {
      console.error('Error al cargar productos:', error);
      this.renderError();
    }
  }

  /**
   * Renderiza los productos en la vista
   */
  renderProductos() {
    const container = document.getElementById('productos-container');

    // Estado vacío
    if (this.productos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h2 class="empty-state-title">No hay productos disponibles</h2>
          <p class="empty-state-text">
            Pronto agregaremos nuevos productos a nuestro catálogo
          </p>
        </div>
      `;
      return;
    }

    // Renderizar grid de productos
    container.innerHTML = `
      <div class="productos-grid">
        ${this.productos.map((producto, index) => this.renderProductoCard(producto, index)).join('')}
      </div>
    `;

    // Añadir event listeners a los botones de agregar
    this.setupProductButtons();
  }

  /**
   * Renderiza una tarjeta de producto
   */
  renderProductoCard(producto, index) {
    const disponible = producto.stock > 0;
    const emoji = this.getProductEmoji(producto.nombre);
    const enCarrito = this.carrito.find(item => item.id === producto.id);

    // Determinar si usar imagen real o emoji de fallback
    const imagenHTML = producto.imagen_url
      ? `<img src="${producto.imagen_url}" alt="${producto.nombre}" class="producto-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
         <span class="producto-imagen-emoji" style="display:none;">${emoji}</span>`
      : `<span class="producto-imagen-emoji">${emoji}</span>`;

    return `
      <article class="producto-card" style="animation-delay: ${index * 0.05}s">
        <div class="producto-imagen">
          ${imagenHTML}
        </div>
        <div class="producto-info">
          <h3 class="producto-nombre">${producto.nombre}</h3>
          <div class="producto-footer">
            <p class="producto-precio">${this.formatCurrency(producto.precio)}</p>
            <span class="producto-disponibilidad ${disponible ? 'disponible' : 'agotado'}">
              <span class="disponibilidad-dot"></span>
              ${disponible ? `${producto.stock} disponibles` : 'Agotado'}
            </span>
          </div>
          ${disponible ? `
            <button class="btn-agregar-carrito" data-id="${producto.id}">
              ${enCarrito ? '✓ En carrito' : '🛒 Agregar'}
            </button>
          ` : ''}
        </div>
      </article>
    `;
  }

  /**
   * Configura event listeners para botones de productos
   */
  setupProductButtons() {
    document.querySelectorAll('.btn-agregar-carrito').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const productoId = e.target.dataset.id;
        const producto = this.productos.find(p => p.id === productoId);
        if (producto) {
          this.agregarAlCarrito(producto);
        }
      });
    });
  }

  /**
   * Configura event listeners generales
   */
  setupEventListeners() {
    // Botón flotante del carrito
    const btnCarrito = document.getElementById('btn-carrito');
    if (btnCarrito) {
      btnCarrito.addEventListener('click', () => this.toggleCarrito());
    }

    // Cerrar carrito
    const btnCerrarCarrito = document.getElementById('btn-cerrar-carrito');
    if (btnCerrarCarrito) {
      btnCerrarCarrito.addEventListener('click', () => this.toggleCarrito());
    }

    // Vaciar carrito
    const btnVaciarCarrito = document.getElementById('btn-vaciar-carrito');
    if (btnVaciarCarrito) {
      btnVaciarCarrito.addEventListener('click', () => this.vaciarCarrito());
    }

    // Confirmar pedido
    const btnConfirmarPedido = document.getElementById('btn-confirmar-pedido');
    if (btnConfirmarPedido) {
      btnConfirmarPedido.addEventListener('click', () => this.abrirModalPedido());
    }

    // Cerrar modal
    const btnCerrarModal = document.getElementById('btn-cerrar-modal');
    if (btnCerrarModal) {
      btnCerrarModal.addEventListener('click', () => this.cerrarModalPedido());
    }

    // Cambio de método de pago
    const metodosPago = document.querySelectorAll('input[name="metodo_pago"]');
    metodosPago.forEach(radio => {
      radio.addEventListener('change', (e) => this.onMetodoPagoChange(e.target.value));
    });

    // Submit del formulario
    const formPedido = document.getElementById('form-pedido');
    if (formPedido) {
      formPedido.addEventListener('submit', (e) => {
        e.preventDefault();
        this.enviarPedido();
      });
    }
  }

  // ==========================================
  // GESTIÓN DEL CARRITO
  // ==========================================

  /**
   * Agrega un producto al carrito
   */
  agregarAlCarrito(producto) {
    const itemExistente = this.carrito.find(item => item.id === producto.id);

    if (itemExistente) {
      // Verificar que no exceda el stock
      if (itemExistente.cantidad < producto.stock) {
        itemExistente.cantidad++;
      } else {
        this.mostrarMensaje('No hay más stock disponible', 'warning');
        return;
      }
    } else {
      this.carrito.push({
        id: producto.id,
        nombre: producto.nombre,
        precio: producto.precio,
        cantidad: 1,
        stock: producto.stock
      });
    }

    this.guardarCarrito();
    this.renderCarrito();
    this.renderProductos(); // Actualizar vista de productos
    this.mostrarMensaje('Producto agregado al carrito', 'success');
  }

  /**
   * Elimina un producto del carrito
   */
  eliminarDelCarrito(productoId) {
    this.carrito = this.carrito.filter(item => item.id !== productoId);
    this.guardarCarrito();
    this.renderCarrito();
    this.renderProductos();
  }

  /**
   * Actualiza la cantidad de un producto en el carrito
   */
  actualizarCantidad(productoId, nuevaCantidad) {
    const item = this.carrito.find(item => item.id === productoId);
    if (!item) return;

    if (nuevaCantidad <= 0) {
      this.eliminarDelCarrito(productoId);
      return;
    }

    if (nuevaCantidad > item.stock) {
      this.mostrarMensaje('Cantidad excede el stock disponible', 'warning');
      return;
    }

    if (nuevaCantidad > CONFIG.CARRITO.MAX_CANTIDAD_POR_PRODUCTO) {
      this.mostrarMensaje(`Máximo ${CONFIG.CARRITO.MAX_CANTIDAD_POR_PRODUCTO} unidades por producto`, 'warning');
      return;
    }

    item.cantidad = nuevaCantidad;
    this.guardarCarrito();
    this.renderCarrito();
  }

  /**
   * Vacía el carrito
   */
  vaciarCarrito() {
    if (this.carrito.length === 0) return;

    if (confirm('¿Deseas vaciar el carrito?')) {
      this.carrito = [];
      this.guardarCarrito();
      this.renderCarrito();
      this.renderProductos();
    }
  }

  /**
   * Calcula el total del carrito
   */
  calcularTotal() {
    return this.carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
  }

  /**
   * Renderiza el carrito
   */
  renderCarrito() {
    // Actualizar badge del botón flotante
    const badge = document.getElementById('carrito-badge');
    const cantidadTotal = this.carrito.reduce((sum, item) => sum + item.cantidad, 0);

    if (badge) {
      badge.textContent = cantidadTotal;
      badge.style.display = cantidadTotal > 0 ? 'flex' : 'none';
    }

    // Actualizar total del botón flotante
    const totalBtn = document.getElementById('carrito-total');
    if (totalBtn) {
      totalBtn.textContent = this.formatCurrency(this.calcularTotal());
    }

    // Renderizar items del carrito
    const carritoItems = document.getElementById('carrito-items');
    if (!carritoItems) return;

    if (this.carrito.length === 0) {
      carritoItems.innerHTML = `
                <div class="carrito-vacio">
                    <p style="font-size: var(--text-3xl); margin-bottom: var(--space-2);">🛍️</p>
                    <p>Tu carrito está vacío</p>
                    <p style="font-size: var(--text-xs); margin-top: var(--space-2);">Agrega productos para comenzar</p>
                </div>
            `;
    } else {
      carritoItems.innerHTML = this.carrito.map(item => this.renderCarritoItem(item)).join('');

      // Añadir event listeners
      this.setupCarritoItemListeners();
    }

    // Actualizar total
    const carritoTotalElement = document.getElementById('carrito-total-amount');
    if (carritoTotalElement) {
      carritoTotalElement.textContent = this.formatCurrency(this.calcularTotal());
    }

    // Habilitar/deshabilitar botón de confirmar pedido
    const btnConfirmar = document.getElementById('btn-confirmar-pedido');
    if (btnConfirmar) {
      btnConfirmar.disabled = this.carrito.length === 0;
    }
  }

  /**
   * Renderiza un item del carrito
   */
  renderCarritoItem(item) {
    return `
            <div class="carrito-item" data-id="${item.id}">
                <div class="carrito-item-info">
                    <h4>${item.nombre}</h4>
                    <p class="carrito-item-precio">${this.formatCurrency(item.precio)}</p>
                </div>
                <div class="carrito-item-controls">
                    <button class="btn-cantidad" data-action="decrementar" data-id="${item.id}">-</button>
                    <input 
                        type="number" 
                        class="carrito-item-cantidad" 
                        value="${item.cantidad}" 
                        min="1" 
                        max="${item.stock}"
                        data-id="${item.id}"
                    >
                    <button class="btn-cantidad" data-action="incrementar" data-id="${item.id}">+</button>
                    <button class="btn-eliminar-item" data-id="${item.id}">🗑️</button>
                </div>
                <p class="carrito-item-subtotal">${this.formatCurrency(item.precio * item.cantidad)}</p>
            </div>
        `;
  }

  /**
   * Configura listeners para items del carrito
   */
  setupCarritoItemListeners() {
    // Botones de cantidad
    document.querySelectorAll('.btn-cantidad').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        const action = e.target.dataset.action;
        const item = this.carrito.find(i => i.id === id);

        if (action === 'incrementar') {
          this.actualizarCantidad(id, item.cantidad + 1);
        } else {
          this.actualizarCantidad(id, item.cantidad - 1);
        }
      });
    });

    // Inputs de cantidad
    document.querySelectorAll('.carrito-item-cantidad').forEach(input => {
      input.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        const cantidad = parseInt(e.target.value);
        this.actualizarCantidad(id, cantidad);
      });
    });

    // Botones de eliminar
    document.querySelectorAll('.btn-eliminar-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        this.eliminarDelCarrito(id);
      });
    });
  }

  /**
   * Toggle mostrar/ocultar carrito
   */
  toggleCarrito() {
    const carritoSidebar = document.getElementById('carrito-sidebar');
    if (carritoSidebar) {
      carritoSidebar.classList.toggle('show');
    }
  }

  // ==========================================
  // GESTIÓN DE PEDIDOS
  // ==========================================

  /**
   * Abre el modal de confirmación de pedido
   */
  abrirModalPedido() {
    if (this.carrito.length === 0) return;

    const modal = document.getElementById('modal-pedido');
    if (modal) {
      modal.classList.add('show');
      // Cerrar carrito
      const carritoSidebar = document.getElementById('carrito-sidebar');
      if (carritoSidebar) {
        carritoSidebar.classList.remove('show');
      }
    }
  }

  /**
   * Cierra el modal de pedido
   */
  cerrarModalPedido() {
    const modal = document.getElementById('modal-pedido');
    if (modal) {
      modal.classList.remove('show');
    }
  }

  /**
   * Maneja cambio de método de pago
   */
  onMetodoPagoChange(metodo) {
    const datosBancarios = document.getElementById('datos-bancarios');
    if (datosBancarios) {
      datosBancarios.style.display = metodo === 'transferencia' ? 'block' : 'none';
    }
  }

  /**
   * Envía el pedido
   */
  async enviarPedido() {
    const formData = new FormData(document.getElementById('form-pedido'));
    const cliente = formData.get('cliente');
    const tiempo_llegada = formData.get('tiempo_llegada');
    const metodo_pago = formData.get('metodo_pago');

    // Construir objeto de pedido
    const pedido = PedidosHelper.formatearPedido(
      { cliente, tiempo_llegada, metodo_pago },
      this.carrito,
      this.calcularTotal()
    );

    // Validar pedido
    const validacion = PedidosHelper.validarPedido(pedido);
    if (!validacion.valid) {
      this.mostrarMensaje(validacion.error, 'error');
      return;
    }

    // Verificar stock
    const productos = await database.getProductos();
    const stockCheck = PedidosHelper.verificarStock(this.carrito, productos);
    if (!stockCheck.valid) {
      this.mostrarMensaje(`${stockCheck.producto}: ${stockCheck.error}`, 'error');
      return;
    }

    // Deshabilitar botón
    const btnSubmit = document.querySelector('#form-pedido button[type="submit"]');
    const textoOriginal = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando...';

    try {
      // Crear pedido
      await database.createPedido(pedido);

      // Limpiar carrito
      this.carrito = [];
      this.guardarCarrito();
      this.renderCarrito();
      this.renderProductos();

      // Cerrar modal
      this.cerrarModalPedido();

      // Limpiar formulario
      document.getElementById('form-pedido').reset();

      // Mostrar confirmación
      this.mostrarMensajeExito();

    } catch (error) {
      console.error('Error al enviar pedido:', error);
      this.mostrarMensaje('Error al enviar el pedido. Por favor intenta nuevamente.', 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = textoOriginal;
    }
  }

  /**
   * Muestra mensaje de éxito al confirmar pedido
   */
  mostrarMensajeExito() {
    const overlay = document.createElement('div');
    overlay.className = 'mensaje-exito-overlay';
    overlay.innerHTML = `
            <div class="mensaje-exito">
                <div class="mensaje-exito-icon">✅</div>
                <h2>¡Pedido Confirmado!</h2>
                <p>Tu pedido ha sido enviado exitosamente.</p>
                <p style="margin-top: var(--space-4); font-size: var(--text-sm); opacity: 0.8;">
                    Te esperamos pronto 🏪
                </p>
            </div>
        `;
    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
    }, 3000);
  }

  // ==========================================
  // PERSISTENCIA
  // ==========================================

  /**
   * Guarda el carrito en localStorage
   */
  guardarCarrito() {
    localStorage.setItem(CONFIG.CARRITO.STORAGE_KEY, JSON.stringify(this.carrito));
  }

  /**
   * Carga el carrito desde localStorage
   */
  cargarCarrito() {
    const carritoGuardado = localStorage.getItem(CONFIG.CARRITO.STORAGE_KEY);
    if (carritoGuardado) {
      try {
        this.carrito = JSON.parse(carritoGuardado);
      } catch (error) {
        console.error('Error al cargar carrito:', error);
        this.carrito = [];
      }
    }
  }

  // ==========================================
  // UTILIDADES
  // ==========================================

  /**
   * Maneja cambios en la base de datos en tiempo real
   */
  async onDatabaseChange(change) {
    console.log('🔄 Actualizando catálogo...', change);
    await this.cargarProductos();
  }

  /**
   * Muestra un mensaje temporal
   */
  mostrarMensaje(texto, tipo = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = texto;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Obtiene un emoji apropiado para el producto
   * (placeholder hasta que se agreguen imágenes reales)
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
    if (lower.includes('arroz') || lower.includes('rice')) return '🍚';
    if (lower.includes('pasta') || lower.includes('spaghetti')) return '🍝';
    if (lower.includes('huevo') || lower.includes('egg')) return '🥚';
    if (lower.includes('queso') || lower.includes('cheese')) return '🧀';
    if (lower.includes('carne') || lower.includes('meat')) return '🥩';
    if (lower.includes('pollo') || lower.includes('chicken')) return '🍗';
    if (lower.includes('pescado') || lower.includes('fish')) return '🐟';

    // Frutas y Verduras
    if (lower.includes('manzana') || lower.includes('apple')) return '🍎';
    if (lower.includes('naranja') || lower.includes('orange')) return '🍊';
    if (lower.includes('plátano') || lower.includes('banana')) return '🍌';
    if (lower.includes('fresa') || lower.includes('strawberry')) return '🍓';
    if (lower.includes('uva') || lower.includes('grape')) return '🍇';
    if (lower.includes('sandía') || lower.includes('watermelon')) return '🍉';
    if (lower.includes('tomate') || lower.includes('tomato')) return '🍅';
    if (lower.includes('zanahoria') || lower.includes('carrot')) return '🥕';
    if (lower.includes('lechuga') || lower.includes('lettuce')) return '🥬';

    // Snacks
    if (lower.includes('palomitas') || lower.includes('popcorn')) return '🍿';
    if (lower.includes('helado') || lower.includes('ice cream')) return '🍦';
    if (lower.includes('pizza')) return '🍕';
    if (lower.includes('hamburguesa') || lower.includes('burger')) return '🍔';
    if (lower.includes('hot dog') || lower.includes('salchicha')) return '🌭';

    // Productos de limpieza
    if (lower.includes('jabón') || lower.includes('soap')) return '🧼';
    if (lower.includes('shampoo') || lower.includes('champú')) return '🧴';
    if (lower.includes('papel') || lower.includes('tissue')) return '🧻';
    if (lower.includes('escoba') || lower.includes('broom')) return '🧹';

    // Default
    return '🛒';
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
}

// ==========================================
// INICIALIZACIÓN
// ==========================================
const catalogo = new CatalogoCliente();

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => catalogo.init());
} else {
  catalogo.init();
}

// Exportar para uso global
window.catalogo = catalogo;
