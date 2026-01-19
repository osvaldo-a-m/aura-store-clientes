/**
 * Cliente de Supabase
 * ===================
 * Inicializa y exporta el cliente de Supabase para uso en toda la aplicación.
 * Este archivo carga Supabase desde CDN y configura la conexión.
 */

let supabaseClient = null;
let isSupabaseAvailable = false;

/**
 * Inicializa el cliente de Supabase
 * @returns {Promise<Object>} Cliente de Supabase o null si no está disponible
 */
async function initSupabase() {
    try {
        // Verificar que CONFIG esté cargado
        if (typeof CONFIG === 'undefined') {
            console.error('❌ CONFIG no está definido. Asegúrate de cargar config.js antes.');
            return null;
        }

        // Verificar que las credenciales estén configuradas
        if (CONFIG.SUPABASE.URL.includes('TU_SUPABASE') ||
            CONFIG.SUPABASE.ANON_KEY.includes('TU_SUPABASE')) {
            console.warn('⚠️  Credenciales de Supabase no configuradas. Usando modo offline (localStorage).');
            isSupabaseAvailable = false;
            return null;
        }

        // Verificar que la librería de Supabase esté cargada
        if (typeof supabase === 'undefined') {
            console.error('❌ Supabase no está cargado. Verifica que el CDN esté incluido en el HTML.');
            isSupabaseAvailable = false;
            return null;
        }

        // Crear el cliente de Supabase
        supabaseClient = supabase.createClient(
            CONFIG.SUPABASE.URL,
            CONFIG.SUPABASE.ANON_KEY
        );

        // Probar la conexión
        const { error } = await supabaseClient
            .from(CONFIG.SUPABASE.TABLE_NAME)
            .select('count')
            .limit(1);

        if (error) {
            console.error('❌ Error al conectar con Supabase:', error.message);
            isSupabaseAvailable = false;
            return null;
        }

        isSupabaseAvailable = true;
        console.log('✅ Supabase conectado exitosamente');
        return supabaseClient;

    } catch (error) {
        console.error('❌ Error al inicializar Supabase:', error);
        isSupabaseAvailable = false;
        return null;
    }
}

/**
 * Obtiene el cliente de Supabase (debe llamarse después de initSupabase)
 * @returns {Object|null} Cliente de Supabase o null
 */
function getSupabaseClient() {
    return supabaseClient;
}

/**
 * Verifica si Supabase está disponible
 * @returns {boolean}
 */
function isOnline() {
    return isSupabaseAvailable;
}

// Exportar funciones para uso global
window.SupabaseService = {
    init: initSupabase,
    getClient: getSupabaseClient,
    isOnline: isOnline
};
