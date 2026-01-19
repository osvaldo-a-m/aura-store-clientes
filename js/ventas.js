/**
 * Controlador de la Página de Reportes de Ventas
 * Con autent

icación de admin
 */
class ReportesVentas {
    constructor() {
        this.ventasPorDia = [];
        this.initialized = false;
        this.isAuthenticated = false;
    }

    async init() {
        if (this.initialized) return;

        // Verificar si ya está autenticado
        this.checkAuth();

        if (this.isAuthenticated) {
            await database.init();
            this.setFechasDefault(); // Set dates FIRST
            this.setupEventListeners();
            await this.cargarVentas(); // Then load data
        } else {
            this.setupLoginListeners();
        }

        this.initialized = true;
        console.log('✅ Reportes de Ventas inicializado');
    }

    /**
     * Verifica si hay sesión activa
     */
    checkAuth() {
        const session = sessionStorage.getItem(CONFIG.ADMIN.SESSION_KEY);

        if (session === 'authenticated') {
            this.isAuthenticated = true;
            this.showMainScreen();
        } else {
            this.isAuthenticated = false;
            this.showLoginScreen();
        }
    }

    /**
     * Muestra pantalla de login
     */
    showLoginScreen() {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('main-screen').style.display = 'none';
    }

    /**
     * Muestra pantalla principal
     */
    showMainScreen() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-screen').style.display = 'block';
    }

    /**
     * Configura listeners del login
     */
    setupLoginListeners() {
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
    }

    /**
     * Maneja el login
     */
    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        // Validar credenciales
        if (username === CONFIG.ADMIN.USERNAME && password === CONFIG.ADMIN.PASSWORD) {
            // Autenticación exitosa
            sessionStorage.setItem(CONFIG.ADMIN.SESSION_KEY, 'authenticated');
            this.isAuthenticated = true;

            // Inicializar sistema
            await database.init();
            this.setFechasDefault(); // Set dates FIRST
            this.setupEventListeners();
            await this.cargarVentas(); // Then load data

            this.showMainScreen();
        } else {
            // Credenciales incorrectas
            this.showLoginError('Usuario o contraseña incorrectos');
        }
    }

    /**
     * Muestra error de login
     */
    showLoginError(mensaje) {
        const errorDiv = document.getElementById('login-error');
        errorDiv.textContent = mensaje;
        errorDiv.style.display = 'block';

        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 3000);
    }

    /**
     * Cierra sesión
     */
    logout() {
        sessionStorage.removeItem(CONFIG.ADMIN.SESSION_KEY);
        this.isAuthenticated = false;
        window.location.reload();
    }

    /**
     * Establece fechas por defecto (últimos 30 días)
     */
    setFechasDefault() {
        const hoy = new Date();
        const hace30Dias = new Date();
        hace30Dias.setDate(hoy.getDate() - 30);

        document.getElementById('fecha-hasta').valueAsDate = hoy;
        document.getElementById('fecha-desde').valueAsDate = hace30Dias;
    }

    /**
     * Carga las ventas del backend
     */
    async cargarVentas() {
        const desde = document.getElementById('fecha-desde').value;
        const hasta = document.getElementById('fecha-hasta').value;

        try {
            this.ventasPorDia = await database.getVentasPorDia(desde, hasta);
            this.renderVentas();
            this.renderResumen();
        } catch (error) {
            console.error('Error al cargar ventas:', error);
            this.mostrarError('Error al cargar las ventas');
        }
    }

    /**
     * Renderiza el resumen general
     */
    renderResumen() {
        const totalPeriodo = this.ventasPorDia.reduce((sum, dia) => sum + dia.total, 0);
        const totalVentas = this.ventasPorDia.reduce((sum, dia) => sum + dia.cantidad, 0);
        const promedio = totalVentas > 0 ? totalPeriodo / totalVentas : 0;

        document.getElementById('total-periodo').textContent = this.formatCurrency(totalPeriodo);
        document.getElementById('total-ventas').textContent = totalVentas;
        document.getElementById('promedio-venta').textContent = this.formatCurrency(promedio);
    }

    /**
     * Renderiza las ventas por día
     */
    renderVentas() {
        const container = document.getElementById('ventas-por-dia-container');

        if (this.ventasPorDia.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p style="font-size: var(--text-3xl);">📭</p>
                    <p>No hay ventas en este período</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.ventasPorDia.map((dia, index) =>
            this.renderDiaCard(dia, index)
        ).join('');

        // Agregar event listeners para expandir/colapsar
        this.setupToggleListeners();
    }

    /**
     * Renderiza una tarjeta de día
     */
    renderDiaCard(dia, index) {
        const fechaFormateada = this.formatFecha(dia.fecha);

        return `
            <div class="dia-card">
                <div class="dia-header" data-dia-index="${index}">
                    <div class="dia-info">
                        <span class="toggle-icon">▶️</span>
                        <div>
                            <h3>${fechaFormateada}</h3>
                            <p class="dia-cantidad">${dia.cantidad} ${dia.cantidad === 1 ? 'venta' : 'ventas'}</p>
                        </div>
                    </div>
                    <div class="dia-total">${this.formatCurrency(dia.total)}</div>
                </div>
                <div class="dia-detalles" id="detalles-${index}" style="display: none;">
                    ${dia.ventas.map(venta => this.renderVentaItem(venta)).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Renderiza un item de venta individual
     */
    renderVentaItem(venta) {
        const hora = new Date(venta.created_at).toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let productos = [];
        try {
            productos = typeof venta.productos === 'string'
                ? JSON.parse(venta.productos)
                : venta.productos;
        } catch (e) {
            productos = [];
        }

        const productosTexto = productos && productos.length > 0
            ? productos.map(p => `${p.cantidad}x ${p.nombre}`).join(', ')
            : 'Sin productos';

        const metodoPago = venta.metodo_pago === 'transferencia' ? 'Transferencia' : 'Efectivo';
        const icono = venta.metodo_pago === 'transferencia' ? '💳' : '💵';

        return `
            <div class="venta-item">
                <div class="venta-hora">${hora}</div>
                <div class="venta-info">
                    <p class="venta-productos">${productosTexto}</p>
                    <p class="venta-metodo">${icono} ${metodoPago}</p>
                </div>
                <div class="venta-total">${this.formatCurrency(venta.total)}</div>
            </div>
        `;
    }

    /**
     * Configura listeners para expandir/colapsar días
     */
    setupToggleListeners() {
        document.querySelectorAll('.dia-header').forEach(header => {
            header.addEventListener('click', () => {
                const index = header.dataset.diaIndex;
                const detalles = document.getElementById(`detalles-${index}`);
                const icon = header.querySelector('.toggle-icon');

                if (detalles.style.display === 'none') {
                    detalles.style.display = 'block';
                    icon.textContent = '▼';
                    header.classList.add('expanded');
                } else {
                    detalles.style.display = 'none';
                    icon.textContent = '▶️';
                    header.classList.remove('expanded');
                }
            });
        });
    }

    /**
     * Configura event listeners
     */
    setupEventListeners() {
        document.getElementById('btn-filtrar').addEventListener('click', () => {
            this.cargarVentas();
        });

        document.getElementById('btn-limpiar-filtros').addEventListener('click', () => {
            this.setFechasDefault();
            this.cargarVentas();
        });

        document.getElementById('btn-logout').addEventListener('click', () => {
            this.logout();
        });
    }

    /**
     * Formatea fecha
     */
    formatFecha(fechaStr) {
        const fecha = new Date(fechaStr + 'T00:00:00');
        const opciones = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };

        const fechaFormateada = fecha.toLocaleDateString('es-MX', opciones);
        // Capitalizar primera letra
        return fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1);
    }

    /**
     * Formatea moneda
     */
    formatCurrency(amount) {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    }

    /**
     * Muestra error
     */
    mostrarError(mensaje) {
        const container = document.getElementById('ventas-por-dia-container');
        container.innerHTML = `
            <div class="error-state">
                <p style="font-size: var(--text-3xl);">❌</p>
                <p>${mensaje}</p>
            </div>
        `;
    }
}

// Inicializar
const reportes = new ReportesVentas();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => reportes.init());
} else {
    reportes.init();
}
