-- ==========================================
-- Script de Configuración de Supabase Storage
-- Sistema POS - Imágenes de Productos
-- ==========================================
-- Ejecuta este script en el SQL Editor de Supabase
-- para configurar el almacenamiento de imágenes

-- ==========================================
-- CREAR BUCKET PARA IMÁGENES DE PRODUCTOS
-- ==========================================
-- Nota: Los buckets en Supabase se crean desde el Dashboard
-- Ve a Storage > Create a new bucket
-- Nombre: product-images
-- Public: Yes (para que las imágenes sean accesibles públicamente)

-- Una vez creado el bucket, ejecuta estas políticas RLS:

-- ==========================================
-- POLÍTICAS DE ACCESO AL STORAGE
-- ==========================================

-- Permitir lectura pública de todas las imágenes
CREATE POLICY "Lectura pública de imágenes de productos"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Permitir subida pública de imágenes (para el sistema POS)
CREATE POLICY "Permitir subida de imágenes"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'product-images');

-- Permitir actualización de imágenes
CREATE POLICY "Permitir actualización de imágenes"
ON storage.objects FOR UPDATE
USING (bucket_id = 'product-images');

-- Permitir eliminación de imágenes
CREATE POLICY "Permitir eliminación de imágenes"
ON storage.objects FOR DELETE
USING (bucket_id = 'product-images');

-- ==========================================
-- INSTRUCCIONES DE CONFIGURACIÓN
-- ==========================================
-- 
-- PASO 1: Crear el bucket manualmente
-- ----------------------------------------
-- 1. Ve a tu proyecto en Supabase Dashboard
-- 2. Navega a Storage en el menú lateral
-- 3. Haz clic en "Create a new bucket"
-- 4. Nombre del bucket: product-images
-- 5. Marca como "Public bucket" (importante para acceso público)
-- 6. Haz clic en "Create bucket"
--
-- PASO 2: Ejecutar este script SQL
-- ----------------------------------------
-- 1. Ve a SQL Editor en Supabase Dashboard
-- 2. Crea una nueva query
-- 3. Copia y pega este script (sin las líneas de comentarios de instrucciones)
-- 4. Ejecuta el script
--
-- PASO 3: Verificar
-- ----------------------------------------
-- Ejecuta esta consulta para verificar las políticas:
--
-- SELECT policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'storage'
-- AND tablename = 'objects';
--
-- ==========================================
-- NOTAS IMPORTANTES
-- ==========================================
-- 
-- 📦 LÍMITES DE ALMACENAMIENTO:
--    - Plan gratuito: 1 GB de almacenamiento
--    - Considera implementar límites de tamaño por imagen
--    - Recomendado: máximo 2MB por imagen
--
-- 🔒 SEGURIDAD:
--    - Las políticas actuales permiten acceso público completo
--    - Para producción, considera restringir uploads solo a usuarios autenticados
--    - Implementa validación de tipos MIME en el cliente
--
-- 🎨 OPTIMIZACIÓN:
--    - Considera comprimir imágenes antes de subirlas
--    - Usa formatos modernos como WebP para mejor rendimiento
--    - Implementa lazy loading en el cliente
--
-- 🗑️ LIMPIEZA:
--    - Cuando elimines un producto, asegúrate de eliminar también su imagen
--    - Implementa limpieza periódica de imágenes huérfanas
