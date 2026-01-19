/**
 * Sistema de Detección de Scanner de Códigos de Barras
 * ====================================================
 * Detecta automáticamente la entrada de un lector de códigos de barras
 * diferenciándola de la escritura manual del usuario.
 * 
 * FUNCIONAMIENTO:
 * - Los scanners emiten caracteres muy rápido (<50ms entre teclas)
 * - La escritura manual normal toma >100ms entre caracteres
 * - Detecta patrones de entrada rápida y emite un evento personalizado
 */

class BarcodeScanner {
    constructor() {
        this.buffer = '';
        this.lastKeyTime = 0;
        this.listening = false;
        this.callback = null;
        this.bufferClearTimer = null;
        this.isScanning = false;  // Bandera para indicar si está en proceso de escaneo
    }

    /**
     * Inicializa el detector de scanner
     * @param {Function} onBarcodeScanned - Callback cuando se detecta un código
     */
    init(onBarcodeScanned) {
        if (this.listening) {
            console.warn('⚠️  BarcodeScanner ya está inicializado');
            return;
        }

        this.callback = onBarcodeScanned;
        this.listening = true;

        // Listener global de teclado
        document.addEventListener('keypress', this.handleKeyPress.bind(this));

        console.log('🔍 BarcodeScanner inicializado');
    }

    /**
     * Maneja cada tecla presionada
     * @param {KeyboardEvent} event - Evento de teclado
     */
    handleKeyPress(event) {
        // Ignorar si hay un input/textarea enfocado (excepto búsqueda de productos)
        const activeElement = document.activeElement;
        const isInputField = activeElement &&
            (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');

        // Permitir scanner solo si no hay campo activo o es el campo de búsqueda
        const isSearchField = activeElement && activeElement.id === 'buscar-producto';

        if (isInputField && !isSearchField) {
            return;
        }

        const currentTime = Date.now();
        const timeDiff = currentTime - this.lastKeyTime;

        // Si es Enter, verificar si tenemos un código válido
        if (event.key === 'Enter') {
            if (this.buffer.length >= CONFIG.SCANNER.MIN_BARCODE_LENGTH) {
                this.isScanning = true;
                event.preventDefault();  // Prevenir submit de formularios
                this.processScan(this.buffer.trim());
            }
            this.clearBuffer();
            this.isScanning = false;
            return;
        }

        // Si el tiempo entre teclas es muy largo, limpiar buffer (escritura manual)
        if (timeDiff > CONFIG.SCANNER.MAX_TIME_BETWEEN_CHARS && this.buffer.length > 0) {
            this.clearBuffer();
        }

        // Agregar caracter al buffer
        this.buffer += event.key;
        this.lastKeyTime = currentTime;

        // Marcar que está escaneando si tiene entrada rápida
        if (timeDiff < CONFIG.SCANNER.MAX_TIME_BETWEEN_CHARS && this.buffer.length > 0) {
            this.isScanning = true;
        }

        // Establecer timer para limpiar el buffer si no se completa
        this.resetClearTimer();
    }

    /**
     * Procesa un código escaneado
     * @param {string} codigo - Código de barras detectado
     */
    processScan(codigo) {
        console.log('📷 Código escaneado:', codigo);

        // Limpiar el campo de búsqueda INMEDIATAMENTE para evitar que se muestren sugerencias
        const searchInput = document.getElementById('buscar-producto');
        if (searchInput) {
            searchInput.value = '';
            // Forzar blur para quitar el foco del campo
            searchInput.blur();
        }

        // Emitir evento personalizado
        const event = new CustomEvent('barcode-scanned', {
            detail: { codigo }
        });
        document.dispatchEvent(event);

        // Llamar callback si existe
        if (this.callback) {
            this.callback(codigo);
        }
    }

    /**
     * Limpia el buffer de caracteres
     */
    clearBuffer() {
        this.buffer = '';
        this.lastKeyTime = 0;
    }

    /**
     * Reinicia el timer de limpieza del buffer
     */
    resetClearTimer() {
        if (this.bufferClearTimer) {
            clearTimeout(this.bufferClearTimer);
        }

        this.bufferClearTimer = setTimeout(() => {
            this.clearBuffer();
        }, CONFIG.SCANNER.BUFFER_CLEAR_TIMEOUT);
    }

    /**
     * Detiene el detector de scanner
     */
    stop() {
        if (!this.listening) return;

        document.removeEventListener('keypress', this.handleKeyPress.bind(this));
        this.listening = false;
        this.clearBuffer();

        if (this.bufferClearTimer) {
            clearTimeout(this.bufferClearTimer);
        }

        console.log('🛑 BarcodeScanner detenido');
    }

    /**
     * Simula un escaneo (útil para pruebas)
     * @param {string} codigo - Código a simular
     */
    simulateScan(codigo) {
        console.log('🧪 Simulando escaneo:', codigo);
        this.processScan(codigo);
    }
}

// Crear instancia global
window.BarcodeScanner = new BarcodeScanner();
