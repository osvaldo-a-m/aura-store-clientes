-- ==========================================
-- Script de Configuración de Base de Datos
-- Sistema POS - Módulo de Pedidos
-- ==========================================
-- Ejecuta este script en el SQL Editor de Supabase
-- para crear las tablas necesarias para el módulo de pedidos

-- ==========================================
-- TABLA: pedidos
-- ==========================================
-- Almacena los pedidos realizados por los clientes
CREATE TABLE IF NOT EXISTS pedidos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cliente TEXT NOT NULL,
  productos JSONB NOT NULL,
  total NUMERIC(10, 2) NOT NULL CHECK (total > 0),
  metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('transferencia', 'efectivo')),
  tiempo_llegada TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completado', 'cancelado'))
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_created ON pedidos(created_at DESC);

-- Comentarios para documentación
COMMENT ON TABLE pedidos IS 'Almacena los pedidos realizados por los clientes desde el catálogo público';
COMMENT ON COLUMN pedidos.cliente IS 'Nombre del cliente que realizó el pedido';
COMMENT ON COLUMN pedidos.productos IS 'Array JSON con los productos del pedido (id, nombre, cantidad, precio)';
COMMENT ON COLUMN pedidos.total IS 'Total del pedido en MXN';
COMMENT ON COLUMN pedidos.metodo_pago IS 'Método de pago: transferencia o efectivo';
COMMENT ON COLUMN pedidos.tiempo_llegada IS 'Tiempo estimado de llegada del cliente';
COMMENT ON COLUMN pedidos.estado IS 'Estado del pedido: pendiente, completado, cancelado';

-- ==========================================
-- TABLA: ventas_diarias
-- ==========================================
-- Registra las ventas completadas para contabilidad
CREATE TABLE IF NOT EXISTS ventas_diarias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  total NUMERIC(10, 2) NOT NULL,
  metodo_pago TEXT NOT NULL,
  productos JSONB NOT NULL
);

-- Índice para reportes por fecha
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas_diarias(created_at DESC);

-- Comentarios
COMMENT ON TABLE ventas_diarias IS 'Registra las ventas completadas para control contable';
COMMENT ON COLUMN ventas_diarias.pedido_id IS 'Referencia al pedido original (opcional)';
COMMENT ON COLUMN ventas_diarias.total IS 'Total de la venta en MXN';
COMMENT ON COLUMN ventas_diarias.metodo_pago IS 'Método de pago utilizado';
COMMENT ON COLUMN ventas_diarias.productos IS 'Array JSON con los productos vendidos';

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================
-- Habilitar RLS en ambas tablas
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_diarias ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- POLÍTICAS DE SEGURIDAD - PEDIDOS
-- ==========================================
-- Permitir lectura pública (para el POS y el catálogo)
CREATE POLICY "Permitir lectura pública de pedidos"
  ON pedidos FOR SELECT
  USING (true);

-- Permitir inserción pública (clientes pueden crear pedidos)
CREATE POLICY "Permitir inserción pública de pedidos"
  ON pedidos FOR INSERT
  WITH CHECK (true);

-- Permitir actualización (para cambiar estado)
CREATE POLICY "Permitir actualización de pedidos"
  ON pedidos FOR UPDATE
  USING (true);

-- ==========================================
-- POLÍTICAS DE SEGURIDAD - VENTAS
-- ==========================================
-- Permitir lectura (para reportes)
CREATE POLICY "Permitir lectura de ventas"
  ON ventas_diarias FOR SELECT
  USING (true);

-- Permitir inserción (POS registra ventas)
CREATE POLICY "Permitir inserción de ventas"
  ON ventas_diarias FOR INSERT
  WITH CHECK (true);

-- ==========================================
-- VERIFICACIÓN
-- ==========================================
-- Ejecuta estas consultas para verificar que todo se creó correctamente:

-- Ver estructura de tablas
-- SELECT table_name, column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name IN ('pedidos', 'ventas_diarias')
-- ORDER BY table_name, ordinal_position;

-- Ver políticas RLS
-- SELECT tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_policies
-- WHERE tablename IN ('pedidos', 'ventas_diarias');

-- ==========================================
-- NOTAS IMPORTANTES
-- ==========================================
-- ⚠️ SEGURIDAD: Estas políticas permiten acceso público.
--    Para producción, considera implementar autenticación y
--    ajustar las políticas según roles de usuario.
--
-- 📝 OPTIMIZACIÓN: Los índices mejorarán el rendimiento de
--    consultas frecuentes. Monitorea el uso y ajusta según sea necesario.
--
-- 🔄 REALTIME: Supabase habilita Realtime automáticamente.
--    No se requiere configuración adicional para las suscripciones.

-- ==========================================
-- MIGRACIÓN: Agregar soporte para imágenes
-- ==========================================
-- Ejecuta este comando si ya tienes la tabla productos creada
-- Para agregar la columna de imagen a productos existentes:

ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url TEXT;

COMMENT ON COLUMN productos.imagen_url IS 'URL de la imagen del producto almacenada en Supabase Storage';
