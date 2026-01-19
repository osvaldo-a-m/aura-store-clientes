/**
 * Capa de Abstracción de Base de Datos
 * =====================================
 * Maneja todas las operaciones CRUD de productos con soporte para:
 * - Supabase (modo online)
 * - localStorage (modo offline/fallback)
 * - Sincronización automática cuando vuelve la conexión
 */

class Database {
    constructor() {
        this.supabase = null;
        this.isOnline = false;
        this.subscribers = [];
        this.syncInterval = null;
    }

    /**
     * Inicializa la base de datos
     */
    async init() {
        this.supabase = await SupabaseService.init();
        this.isOnline = SupabaseService.isOnline();

        // Si estamos online, intentar sincronizar cambios pendientes
        if (this.isOnline) {
            await this.syncPendingChanges();
            this.subscribeToRealtimeChanges();
        } else {
            // Si estamos offline, intentar reconectar cada X minutos
            this.startSyncRetry();
        }

        console.log(this.isOnline ? '🌐 Modo: ONLINE (Supabase)' : '💾 Modo: OFFLINE (localStorage)');
    }

    // ==========================================
    // OPERACIONES CRUD
    // ==========================================

    /**
     * Obtiene todos los productos
     * @returns {Promise<Array>} Lista de productos
     */
    async getProductos() {
        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.SUPABASE.TABLE_NAME)
                    .select('*')
                    .order('nombre', { ascending: true });

                if (error) throw error;

                // Actualizar cache local
                this.saveToLocalStorage(data);
                return data || [];
            } catch (error) {
                console.error('Error al obtener productos de Supabase:', error);
                return this.getFromLocalStorage();
            }
        } else {
            return this.getFromLocalStorage();
        }
    }

    /**
     * Busca un producto por código de barras
     * @param {string} codigo - Código de barras
     * @returns {Promise<Object|null>} Producto encontrado o null
     */
    async getProductoPorCodigo(codigo) {
        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.SUPABASE.TABLE_NAME)
                    .select('*')
                    .eq('codigo_barras', codigo)
                    .single();

                if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
                return data || null;
            } catch (error) {
                console.error('Error al buscar producto:', error);
                return this.searchInLocalStorage(codigo);
            }
        } else {
            return this.searchInLocalStorage(codigo);
        }
    }

    /**
     * Agrega un nuevo producto
     * @param {Object} producto - Datos del producto
     * @returns {Promise<Object>} Producto creado
     */
    async addProducto(producto) {
        const nuevoProducto = {
            codigo_barras: producto.codigo_barras,
            nombre: producto.nombre,
            precio: parseFloat(producto.precio),
            stock: parseInt(producto.stock),
            imagen_url: producto.imagen_url || null,
            created_at: new Date().toISOString()
        };

        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.SUPABASE.TABLE_NAME)
                    .insert([nuevoProducto])
                    .select()
                    .single();

                if (error) throw error;

                // Actualizar cache local
                const productos = this.getFromLocalStorage();
                productos.push(data);
                this.saveToLocalStorage(productos);

                return data;
            } catch (error) {
                console.error('Error al agregar producto:', error);
                // Guardar en pendientes para sincronizar después
                this.savePendingChange('insert', nuevoProducto);
                throw error;
            }
        } else {
            // Modo offline: generar ID temporal y guardar localmente
            nuevoProducto.id = 'temp_' + Date.now();
            const productos = this.getFromLocalStorage();
            productos.push(nuevoProducto);
            this.saveToLocalStorage(productos);

            // Guardar para sincronizar después
            this.savePendingChange('insert', nuevoProducto);

            return nuevoProducto;
        }
    }

    /**
     * Actualiza el stock de un producto
     * @param {string} id - ID del producto
     * @param {number} nuevaCantidad - Nueva cantidad de stock
     * @returns {Promise<Object>} Producto actualizado
     */
    async updateStock(id, nuevaCantidad) {
        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.SUPABASE.TABLE_NAME)
                    .update({ stock: nuevaCantidad })
                    .eq('id', id)
                    .select()
                    .single();

                if (error) throw error;

                // Actualizar cache local
                this.updateInLocalStorage(id, { stock: nuevaCantidad });

                return data;
            } catch (error) {
                console.error('Error al actualizar stock:', error);
                this.savePendingChange('update', { id, stock: nuevaCantidad });
                throw error;
            }
        } else {
            // Modo offline
            this.updateInLocalStorage(id, { stock: nuevaCantidad });
            this.savePendingChange('update', { id, stock: nuevaCantidad });

            const productos = this.getFromLocalStorage();
            return productos.find(p => p.id === id);
        }
    }

    /**
     * Elimina un producto
     * @param {string} id - ID del producto
     * @returns {Promise<boolean>} True si se eliminó correctamente
     */
    async deleteProducto(id) {
        if (this.isOnline) {
            try {
                // Primero obtener el producto para acceder a su imagen_url
                const { data: producto, error: fetchError } = await this.supabase
                    .from(CONFIG.SUPABASE.TABLE_NAME)
                    .select('imagen_url')
                    .eq('id', id)
                    .single();

                if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

                // Eliminar el producto de la base de datos
                const { error } = await this.supabase
                    .from(CONFIG.SUPABASE.TABLE_NAME)
                    .delete()
                    .eq('id', id);

                if (error) throw error;

                // Si el producto tiene imagen, eliminarla del storage
                if (producto && producto.imagen_url) {
                    await this.deleteProductImage(producto.imagen_url);
                }

                // Eliminar del cache local
                this.deleteFromLocalStorage(id);

                return true;
            } catch (error) {
                console.error('Error al eliminar producto:', error);
                this.savePendingChange('delete', { id });
                throw error;
            }
        } else {
            this.deleteFromLocalStorage(id);
            this.savePendingChange('delete', { id });
            return true;
        }
    }

    // ==========================================
    // GESTIÓN DE IMÁGENES
    // ==========================================

    /**
     * Sube una imagen de producto al storage
     * @param {File} file - Archivo de imagen
     * @param {string} productId - ID del producto (opcional, se genera si no existe)
     * @returns {Promise<string>} URL pública de la imagen
     */
    async uploadProductImage(file, productId = null) {
        if (!this.isOnline) {
            throw new Error('No se pueden subir imágenes en modo offline');
        }

        // Validar tipo de archivo
        if (!CONFIG.IMAGES.ALLOWED_TYPES.includes(file.type)) {
            throw new Error(`Tipo de archivo no permitido. Use: ${CONFIG.IMAGES.ALLOWED_EXTENSIONS.join(', ')}`);
        }

        // Validar tamaño
        if (file.size > CONFIG.IMAGES.MAX_FILE_SIZE) {
            const maxSizeMB = CONFIG.IMAGES.MAX_FILE_SIZE / (1024 * 1024);
            throw new Error(`El archivo es demasiado grande. Tamaño máximo: ${maxSizeMB}MB`);
        }

        try {
            // Generar nombre único para la imagen
            const timestamp = Date.now();
            const randomStr = Math.random().toString(36).substring(2, 8);
            const extension = file.name.split('.').pop();
            const fileName = productId
                ? `${productId}_${timestamp}.${extension}`
                : `product_${timestamp}_${randomStr}.${extension}`;

            const filePath = `${fileName}`;

            // Subir archivo
            const { data, error } = await this.supabase.storage
                .from(CONFIG.IMAGES.STORAGE_BUCKET)
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) throw error;

            // Obtener URL pública
            const { data: { publicUrl } } = this.supabase.storage
                .from(CONFIG.IMAGES.STORAGE_BUCKET)
                .getPublicUrl(filePath);

            console.log('✅ Imagen subida exitosamente:', publicUrl);
            return publicUrl;

        } catch (error) {
            console.error('Error al subir imagen:', error);
            throw error;
        }
    }

    /**
     * Elimina una imagen del storage
     * @param {string} imageUrl - URL de la imagen a eliminar
     * @returns {Promise<boolean>} True si se eliminó correctamente
     */
    async deleteProductImage(imageUrl) {
        if (!this.isOnline) {
            console.warn('No se puede eliminar imagen en modo offline');
            return false;
        }

        if (!imageUrl) return false;

        try {
            // Extraer el nombre del archivo de la URL
            const urlParts = imageUrl.split('/');
            const fileName = urlParts[urlParts.length - 1];

            const { error } = await this.supabase.storage
                .from(CONFIG.IMAGES.STORAGE_BUCKET)
                .remove([fileName]);

            if (error) {
                console.warn('Error al eliminar imagen del storage:', error);
                return false;
            }

            console.log('✅ Imagen eliminada del storage');
            return true;

        } catch (error) {
            console.error('Error al eliminar imagen:', error);
            return false;
        }
    }

    /**
     * Actualiza la imagen de un producto existente
     * @param {string} productId - ID del producto
     * @param {File} file - Nueva imagen
     * @returns {Promise<string>} URL de la nueva imagen
     */
    async updateProductImage(productId, file) {
        if (!this.isOnline) {
            throw new Error('No se pueden actualizar imágenes en modo offline');
        }

        try {
            // Obtener producto actual
            const { data: producto, error: fetchError } = await this.supabase
                .from(CONFIG.SUPABASE.TABLE_NAME)
                .select('imagen_url')
                .eq('id', productId)
                .single();

            if (fetchError) throw fetchError;

            // Eliminar imagen anterior si existe
            if (producto.imagen_url) {
                await this.deleteProductImage(producto.imagen_url);
            }

            // Subir nueva imagen
            const nuevaImagenUrl = await this.uploadProductImage(file, productId);

            // Actualizar URL en la base de datos
            const { error: updateError } = await this.supabase
                .from(CONFIG.SUPABASE.TABLE_NAME)
                .update({ imagen_url: nuevaImagenUrl })
                .eq('id', productId);

            if (updateError) throw updateError;

            // Actualizar cache local
            this.updateInLocalStorage(productId, { imagen_url: nuevaImagenUrl });

            return nuevaImagenUrl;

        } catch (error) {
            console.error('Error al actualizar imagen:', error);
            throw error;
        }
    }

    // ==========================================
    // SINCRONIZACIÓN EN TIEMPO REAL
    // ==========================================

    /**
     * Suscribe a cambios en tiempo real de Supabase
     */
    subscribeToRealtimeChanges() {
        if (!this.isOnline) return;

        this.supabase
            .channel('productos_changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: CONFIG.SUPABASE.TABLE_NAME
                },
                (payload) => {
                    console.log('🔄 Cambio detectado:', payload);
                    this.notifySubscribers(payload);
                }
            )
            .subscribe();
    }

    /**
     * Permite que otros módulos se suscriban a cambios
     * @param {Function} callback - Función a llamar cuando hay cambios
     */
    onDataChange(callback) {
        this.subscribers.push(callback);
    }

    /**
     * Notifica a todos los suscriptores de un cambio
     * @param {Object} change - Datos del cambio
     */
    notifySubscribers(change) {
        this.subscribers.forEach(callback => callback(change));
    }

    // ==========================================
    // SINCRONIZACIÓN OFFLINE
    // ==========================================

    /**
     * Guarda un cambio pendiente para sincronizar después
     * @param {string} operation - Tipo de operación (insert, update, delete)
     * @param {Object} data - Datos del cambio
     */
    savePendingChange(operation, data) {
        const pending = this.getPendingChanges();
        pending.push({
            operation,
            data,
            timestamp: Date.now()
        });
        localStorage.setItem(CONFIG.STORAGE.PENDING_CHANGES_KEY, JSON.stringify(pending));
    }

    /**
     * Obtiene los cambios pendientes de sincronizar
     * @returns {Array} Cambios pendientes
     */
    getPendingChanges() {
        const pending = localStorage.getItem(CONFIG.STORAGE.PENDING_CHANGES_KEY);
        return pending ? JSON.parse(pending) : [];
    }

    /**
     * Sincroniza los cambios pendientes con Supabase
     */
    async syncPendingChanges() {
        if (!this.isOnline) return;

        const pending = this.getPendingChanges();
        if (pending.length === 0) return;

        console.log(`🔄 Sincronizando ${pending.length} cambios pendientes...`);

        for (const change of pending) {
            try {
                switch (change.operation) {
                    case 'insert':
                        await this.supabase
                            .from(CONFIG.SUPABASE.TABLE_NAME)
                            .insert([change.data]);
                        break;
                    case 'update':
                        await this.supabase
                            .from(CONFIG.SUPABASE.TABLE_NAME)
                            .update(change.data)
                            .eq('id', change.data.id);
                        break;
                    case 'delete':
                        await this.supabase
                            .from(CONFIG.SUPABASE.TABLE_NAME)
                            .delete()
                            .eq('id', change.data.id);
                        break;
                }
            } catch (error) {
                console.error('Error al sincronizar cambio:', error);
            }
        }

        // Limpiar cambios pendientes
        localStorage.removeItem(CONFIG.STORAGE.PENDING_CHANGES_KEY);
        console.log('✅ Sincronización completada');
    }

    /**
     * Inicia reintento de sincronización periódica
     */
    startSyncRetry() {
        this.syncInterval = setInterval(async () => {
            console.log('🔄 Intentando reconectar...');
            await this.init();
        }, CONFIG.STORAGE.SYNC_RETRY_INTERVAL);
    }

    // ==========================================
    // OPERACIONES CON LOCALSTORAGE
    // ==========================================

    /**
     * Obtiene productos del localStorage
     * @returns {Array} Lista de productos
     */
    getFromLocalStorage() {
        const data = localStorage.getItem(CONFIG.STORAGE.PRODUCTOS_KEY);
        return data ? JSON.parse(data) : [];
    }

    /**
     * Guarda productos en localStorage
     * @param {Array} productos - Lista de productos
     */
    saveToLocalStorage(productos) {
        localStorage.setItem(CONFIG.STORAGE.PRODUCTOS_KEY, JSON.stringify(productos));
        localStorage.setItem(CONFIG.STORAGE.LAST_SYNC_KEY, new Date().toISOString());
    }

    /**
     * Busca un producto en localStorage por código
     * @param {string} codigo - Código de barras
     * @returns {Object|null} Producto encontrado
     */
    searchInLocalStorage(codigo) {
        const productos = this.getFromLocalStorage();
        return productos.find(p => p.codigo_barras === codigo) || null;
    }

    /**
     * Actualiza un producto en localStorage
     * @param {string} id - ID del producto
     * @param {Object} updates - Campos a actualizar
     */
    updateInLocalStorage(id, updates) {
        const productos = this.getFromLocalStorage();
        const index = productos.findIndex(p => p.id === id);
        if (index !== -1) {
            productos[index] = { ...productos[index], ...updates };
            this.saveToLocalStorage(productos);
        }
    }

    /**
     * Elimina un producto del localStorage
     * @param {string} id - ID del producto
     */
    deleteFromLocalStorage(id) {
        const productos = this.getFromLocalStorage();
        const filtered = productos.filter(p => p.id !== id);
        this.saveToLocalStorage(filtered);
    }

    // ==========================================
    // OPERACIONES DE PEDIDOS
    // ==========================================

    /**
     * Obtiene todos los pedidos pendientes
     * @returns {Promise<Array>} Lista de pedidos pendientes
     */
    async getPedidosPendientes() {
        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.PEDIDOS.TABLA_PEDIDOS)
                    .select('*')
                    .eq('estado', 'pendiente')
                    .order('created_at', { ascending: false });

                if (error) throw error;
                return data || [];
            } catch (error) {
                console.error('Error al obtener pedidos pendientes:', error);
                return [];
            }
        } else {
            // En modo offline, retornar array vacío
            return [];
        }
    }

    /**
     * Crea un nuevo pedido
     * @param {Object} pedido - Datos del pedido
     * @returns {Promise<Object>} Pedido creado
     */
    async createPedido(pedido) {
        const nuevoPedido = {
            cliente: pedido.cliente,
            productos: pedido.productos, // Array de objetos
            total: parseFloat(pedido.total),
            metodo_pago: pedido.metodo_pago,
            tiempo_llegada: pedido.tiempo_llegada,
            estado: 'pendiente',
            created_at: new Date().toISOString()
        };

        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.PEDIDOS.TABLA_PEDIDOS)
                    .insert([nuevoPedido])
                    .select()
                    .single();

                if (error) throw error;
                return data;
            } catch (error) {
                console.error('Error al crear pedido:', error);
                throw error;
            }
        } else {
            throw new Error('No se pueden crear pedidos en modo offline');
        }
    }

    /**
     * Actualiza el estado de un pedido
     * @param {string} id - ID del pedido
     * @param {string} estado - Nuevo estado (pendiente, completado, cancelado)
     * @returns {Promise<Object>} Pedido actualizado
     */
    async updatePedidoEstado(id, estado) {
        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.PEDIDOS.TABLA_PEDIDOS)
                    .update({ estado })
                    .eq('id', id)
                    .select()
                    .single();

                if (error) throw error;
                return data;
            } catch (error) {
                console.error('Error al actualizar estado del pedido:', error);
                throw error;
            }
        } else {
            throw new Error('No se puede actualizar pedido en modo offline');
        }
    }

    /**
     * Crea un registro de venta
     * @param {Object} venta - Datos de la venta
     * @returns {Promise<Object>} Registro de venta creado
     */
    async createVenta(venta) {
        const nuevaVenta = {
            pedido_id: venta.pedido_id || null,
            total: parseFloat(venta.total),
            metodo_pago: venta.metodo_pago,
            productos: venta.productos,
            created_at: new Date().toISOString()
        };

        if (this.isOnline) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.PEDIDOS.VENTAS_TABLE)
                    .insert([nuevaVenta])
                    .select()
                    .single();

                if (error) throw error;
                return data;
            } catch (error) {
                console.error('Error al crear registro de venta:', error);
                throw error;
            }
        } else {
            throw new Error('No se pueden registrar ventas en modo offline');
        }
    }

    /**
     * Actualiza el stock de múltiples productos
     * @param {Array} updates - Array de objetos {id, cantidad}
     * @returns {Promise<boolean>} True si se actualizó correctamente
     */
    async updateMultipleStock(updates) {
        if (this.isOnline) {
            try {
                // Procesar cada actualización
                for (const update of updates) {
                    const { id, cantidad } = update;

                    // Obtener stock actual
                    const { data: producto, error: fetchError } = await this.supabase
                        .from(CONFIG.SUPABASE.TABLE_NAME)
                        .select('stock')
                        .eq('id', id)
                        .single();

                    if (fetchError) throw fetchError;

                    // Calcular nuevo stock
                    const nuevoStock = producto.stock - cantidad;

                    // Actualizar
                    const { error: updateError } = await this.supabase
                        .from(CONFIG.SUPABASE.TABLE_NAME)
                        .update({ stock: nuevoStock })
                        .eq('id', id);

                    if (updateError) throw updateError;

                    // Actualizar cache local
                    this.updateInLocalStorage(id, { stock: nuevoStock });
                }

                return true;
            } catch (error) {
                console.error('Error al actualizar stock múltiple:', error);
                throw error;
            }
        } else {
            throw new Error('No se puede actualizar stock en modo offline');
        }
    }

    /**
     * Suscribe a cambios en tiempo real de pedidos
     * @param {Function} callback - Función a llamar cuando hay un nuevo pedido
     */
    subscribeToPedidos(callback) {
        if (!this.isOnline) return;

        this.supabase
            .channel('pedidos_changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: CONFIG.PEDIDOS.TABLA_PEDIDOS
                },
                (payload) => {
                    console.log('🔔 Nuevo pedido recibido:', payload);
                    callback(payload.new);
                }
            )
            .subscribe();
    }

    /**
     * Obtiene ventas agrupadas por día para reportes
     * @param {string} fechaDesde - Fecha desde (YYYY-MM-DD)
     * @param {string} fechaHasta - Fecha hasta (YYYY-MM-DD)
     * @returns {Promise<Array>} Ventas agrupadas por día
     */
    async getVentasPorDia(fechaDesde, fechaHasta) {
        if (!this.isOnline) {
            throw new Error('No se pueden obtener reportes en modo offline');
        }

        try {
            // Obtener todas las ventas en el rango de fechas
            const { data: ventas, error } = await this.supabase
                .from(CONFIG.PEDIDOS.VENTAS_TABLE)
                .select('*')
                .gte('created_at', `${fechaDesde}T00:00:00`)
                .lte('created_at', `${fechaHasta}T23:59:59`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Agrupar ventas por día
            const ventasPorDia = {};

            ventas.forEach(venta => {
                const fecha = venta.created_at.split('T')[0]; // YYYY-MM-DD

                if (!ventasPorDia[fecha]) {
                    ventasPorDia[fecha] = {
                        fecha: fecha,
                        total: 0,
                        cantidad: 0,
                        ventas: []
                    };
                }

                ventasPorDia[fecha].total += parseFloat(venta.total);
                ventasPorDia[fecha].cantidad += 1;
                ventasPorDia[fecha].ventas.push(venta);
            });

            // Convertir a array y ordenar por fecha descendente
            const resultado = Object.values(ventasPorDia).sort((a, b) => {
                return new Date(b.fecha) - new Date(a.fecha);
            });

            return resultado;

        } catch (error) {
            console.error('Error al obtener ventas por día:', error);
            throw error;
        }
    }
}

// Crear instancia global
window.database = new Database();

