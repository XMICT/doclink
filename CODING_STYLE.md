# Estilo de Programación — xmict

Guía de referencia para cualquier modelo de IA. Aplica a cualquier proyecto independientemente del stack, lenguaje, o si es frontend o backend. Los ejemplos están en JavaScript por ser el lenguaje principal, pero los principios son universales.

---

## Índice

1. [Principios fundamentales](#1-principios-fundamentales)
2. [Arquitectura y organización](#2-arquitectura-y-organización)
3. [Estilo de código](#3-estilo-de-código)
4. [Manejo de errores](#4-manejo-de-errores)
5. [Operaciones asíncronas](#5-operaciones-asíncronas)
6. [Nomenclatura](#6-nomenclatura)
7. [Comentarios y documentación](#7-comentarios-y-documentación)
8. [Refactorización](#8-refactorización)
9. [Commits](#9-commits)
10. [Constantes sobre valores literales](#10-constantes-sobre-valores-literales)
11. [Parámetros opcionales como objeto](#11-parámetros-opcionales-como-objeto)
12. [async/await siempre](#12-asyncawait-siempre)

---

## 1. Principios fundamentales

Estas son las reglas que guían cada decisión de código. Cuando existe conflicto entre dos opciones, estos principios definen cuál elegir.

### Simplicidad ante todo

Si dos soluciones producen el mismo resultado, siempre se elige la más corta. El código que no existe no tiene bugs.

```js
// ✓ Directo
const nombre = persona.nombre ?? 'Sin nombre'

// ✗ Innecesariamente verboso
let nombre
if (persona.nombre !== null && persona.nombre !== undefined) {
    nombre = persona.nombre
} else {
    nombre = 'Sin nombre'
}
```

No se crean abstracciones, clases, helpers ni carpetas hasta que haya una necesidad real. Tres líneas repetidas no justifican un helper si cada contexto tiene matices distintos.

### Legibilidad sobre inteligencia

El código se lee muchas más veces de las que se escribe. Un nombre largo y claro siempre gana sobre uno corto y críptico.

```js
// ✓ Se entiende sin leer el cuerpo
async function obtenerEmpresasAccesiblesParaUsuario(userId) { ... }

// ✗ Requiere leer el cuerpo para entender qué hace
async function getEmps(id) { ... }
```

Nunca se sacrifica legibilidad para ahorrar líneas. Si un one-liner necesita un comentario para entenderse, es mejor escribirlo en dos líneas.

### Estructura consistente

Cada tipo de archivo tiene su lugar y su forma. La estructura no cambia de un archivo a otro. Cuando alguien abre un archivo, ya sabe dónde encontrar cada cosa porque todos los archivos del mismo tipo están organizados igual.

Esto aplica igual en frontend (components, hooks, services, utils) que en backend (controllers, use-cases, services, models).

### Reutilizar antes de crear

Antes de escribir código nuevo, primero se busca si ya existe algo que resuelva el problema, total o parcialmente. Si existe pero no encaja exactamente, se adapta o se generaliza. Solo cuando no hay nada aprovechable se escribe desde cero.

```js
// ✓ Reutilizar y adaptar la función existente
import { formatearFecha } from '@/utils/fecha'
const fechaVisible = formatearFecha(documento.fh_creacion, 'DD/MM/YYYY')

// ✗ Reimplementar lo mismo en cada componente/módulo
const fecha = new Date(documento.fh_creacion)
const dia = fecha.getDate().toString().padStart(2, '0')
const mes = (fecha.getMonth() + 1).toString().padStart(2, '0')
const anio = fecha.getFullYear()
const fechaVisible = `${dia}/${mes}/${anio}`
```

---

## 2. Arquitectura y organización

### Separación por capas

El código siempre está dividido en capas con responsabilidades claras. Cada capa solo conoce a la inmediatamente inferior. En backend y frontend el nombre de las capas cambia, pero el concepto es el mismo.

**Backend:**
```
Entrada (Router/Controller) → Lógica de negocio (UseCase/Service) → Acceso a datos (Model/Repository)
```

**Frontend:**
```
Vista (Component/Page) → Lógica de UI (Hook/Composable) → Acceso a datos (Service/Store)
```

La regla es siempre la misma: **la vista no habla directamente con la fuente de datos**.

```js
// ✓ El componente delega al hook, el hook al servicio
function FacturasList() {
    const { facturas, isLoading } = useFacturas()
    return <List items={facturas} loading={isLoading} />
}

// ✗ El componente hace la llamada directamente
function FacturasList() {
    const [facturas, setFacturas] = useState([])
    useEffect(() => {
        fetch('/api/facturas').then(r => r.json()).then(setFacturas)
    }, [])
}
```

### Un archivo, una responsabilidad

Cada archivo tiene un único propósito. Si un archivo hace dos cosas distintas, se parte en dos. Los nombres de los archivos reflejan exactamente qué contienen.

```
ObtenerReporteBalanzaUseCase.js   ← un use case
ContpaqService.js                 ← un servicio externo
parseBodyFiltro.js                ← una utilidad
useFacturas.js                    ← un hook
```

### Punto de entrada único por módulo

Cuando un módulo tiene varios archivos, se expone a través de un `index.js`. Quien consume el módulo nunca necesita saber cómo está organizado internamente.

```js
// ✓ El consumidor importa del módulo, no del archivo interno
import { formatearFecha, diferenciaEnDias } from '@/utils/fecha'

// ✗ Acoplado a la estructura interna
import { formatearFecha } from '@/utils/fecha/formatters/date'
import { diferenciaEnDias } from '@/utils/fecha/calculators/diff'
```

### Clases base para comportamiento compartido

Cuando varios módulos o modelos comparten el mismo comportamiento, se extrae a una clase base. Los hijos solo sobreescriben lo que difiere.

```js
class BaseUseCase {
    static get models() {
        return require('../models').sequelize.models
    }
}

class ObtenerBalanzaUseCase extends BaseUseCase {
    static async execute(params) {
        const { CuContable } = this.models
        // ...
    }
}
```

---

## 3. Estilo de código

### Desestructurar al inicio

Los parámetros y las propiedades de objetos se extraen al inicio de la función, no en el momento de usarse. Esto hace visible de un vistazo qué datos usa la función.

```js
// ✓ Todo lo que se usa está declarado arriba
function procesarPago({ importe, moneda, id_proveedor, referencia = null }) {
    // ...
}

// En controladores, toda la extracción del request en la primera línea
const { user: { userId }, params: { id_empresa }, body: { id_sucursal, restablecer = 0 } } = req
```

### Early return para reducir anidamiento

En lugar de envolver todo en un `if`, se retorna o lanza al detectar la condición inválida. El código "feliz" queda al mismo nivel de indentación, sin anidarse.

```js
// ✓ Early return — el flujo principal queda limpio
async function procesarDocumento(documento) {
    if (!documento.id_poliza) return
    if (!documento.estaActivo()) throw 'El documento no está activo'

    // flujo principal sin anidamiento
    const poliza = await Poliza.findByPk(documento.id_poliza)
    await poliza.concluir()
}

// ✗ Todo anidado
async function procesarDocumento(documento) {
    if (documento.id_poliza) {
        if (documento.estaActivo()) {
            const poliza = await Poliza.findByPk(documento.id_poliza)
            await poliza.concluir()
        } else {
            throw 'El documento no está activo'
        }
    }
}
```

### Operadores modernos

Se usan los operadores del lenguaje que simplifican el código. No se reinventa con condicionales lo que ya existe.

```js
// Nullish coalescing — fallback solo cuando es null/undefined
const nombre = usuario.nombre ?? 'Sin nombre'

// Nullish assignment — asigna solo si no existe
datos.operaciones ??= obtenerOperacionesPorDefecto()

// Optional chaining — acceso seguro a métodos opcionales
const tipo = await documento.getTipoCliente?.() || null

// Spread condicional en objetos
const where = {
    activo: true,
    ...(id_sucursal ? { id_sucursal } : {}),
}
```

### Estructuras de datos adecuadas

Se elige la estructura según el caso de uso, no por costumbre.

```js
// Set para existencia rápida (O(1))
const idsVistos = new Set()
const noRepetidos = items.filter(item => {
    if (idsVistos.has(item.id)) return false
    idsVistos.add(item.id)
    return true
})

// Map cuando necesitas clave → valor asociado
const porEmpresa = new Map()
for (const poliza of polizas) {
    if (!porEmpresa.has(poliza.id_empresa)) porEmpresa.set(poliza.id_empresa, [])
    porEmpresa.get(poliza.id_empresa).push(poliza)
}
```

### Encadenamiento de transformaciones

Para transformar colecciones se encadenan `map`, `filter`, `reduce` en lugar de usar loops imperativos con variables acumuladoras.

```js
// ✓ Declarativo — describe qué se quiere
const modulosActivos = Object.fromEntries(
    Object.keys(SYSTEM_MODULES)
        .filter(key => SYSTEM_MODULES[key].activo)
        .map(key => [key, SYSTEM_MODULES[key].descripcion.toUpperCase()])
)

// ✗ Imperativo — describe cómo hacerlo paso a paso
const modulosActivos = {}
for (const key of Object.keys(SYSTEM_MODULES)) {
    if (SYSTEM_MODULES[key].activo) {
        modulosActivos[key] = SYSTEM_MODULES[key].descripcion.toUpperCase()
    }
}
```

---

## 4. Manejo de errores

### Errores de negocio como strings

Los errores de lógica de negocio se lanzan como strings en español, listos para mostrar al usuario. El mensaje incluye contexto suficiente para entender qué falló y por qué.

```js
// ✓ Mensaje específico con contexto
throw `No se encontró configuración de póliza para el módulo (${modelo.getNombre()}) con la acción (${accion.descripcion})`

// ✗ Mensaje genérico que no ayuda
throw 'Error de configuración'
```

### Errores de validación como objetos estructurados

Cuando el error corresponde a un campo específico del formulario o request, se lanza como array de objetos `{ field, message }`.

```js
throw [{ field: 'importe', message: 'El importe es requerido' }]
throw [
    { field: 'fecha_inicio', message: 'La fecha de inicio es requerida' },
    { field: 'fecha_fin',    message: 'La fecha de fin debe ser posterior a la de inicio' },
]
```

### Relanzar con contexto

Cuando se captura un error en un catch, se normaliza y se relanza añadiendo el contexto de la operación que falló.

```js
try {
    await generarPoliza(documento)
} catch (error) {
    const mensaje = normalizarError(error)
    throw `Error al generar la póliza de reversión. ${mensaje}.`
}
```

### En el punto de entrada (controlador o componente)

El catch en el punto de entrada nunca re-lanza: captura y responde o muestra el error al usuario.

```js
// Backend
try {
    const data = await MiUseCase.execute(params)
    responder(res, { success: true, data })
} catch (error) {
    responder(res, { success: false, data: error })
}

// Frontend
try {
    await guardarFactura(datos)
    notificar({ tipo: 'exito', mensaje: 'Factura guardada' })
} catch (error) {
    notificar({ tipo: 'error', mensaje: error })
}
```

---

## 5. Operaciones asíncronas

### Paralelo siempre que sea posible

Cuando dos o más operaciones son independientes entre sí, se ejecutan en paralelo. No se espera una para empezar la siguiente si no hay dependencia.

```js
// ✓ Las tres queries corren al mismo tiempo
const [empresas, sucursales, usuarios] = await Promise.all([
    Empresa.findAll(),
    Sucursal.findAll({ where: { activo: true } }),
    Usuario.findAll({ where: { id_empresa } }),
])

// ✗ Secuencial sin necesidad — el total tarda 3× más
const empresas   = await Empresa.findAll()
const sucursales = await Sucursal.findAll({ where: { activo: true } })
const usuarios   = await Usuario.findAll({ where: { id_empresa } })
```

### Caché lazy para valores costosos

Los valores que requieren computación o I/O costosa y no cambian en tiempo de ejecución se cachean la primera vez que se calculan.

```js
let _cache = null

function obtenerModulosPorId() {
    if (_cache) return _cache
    _cache = construirMapaDeModulos()
    Object.freeze(_cache)   // inmutable después de construirse
    return _cache
}
```

---

## 6. Nomenclatura

### Convenciones por tipo

| Elemento | Convención | Ejemplo |
|---|---|---|
| Variables y parámetros | camelCase | `polizaReversion`, `isLoading`, `datosFactura` |
| Funciones y métodos | camelCase, verbo al inicio | `obtenerEmpresa()`, `calcularTotal()`, `handleSubmit()` |
| Clases, componentes | PascalCase | `PolizaService`, `FacturasList`, `TableroPolizasUseCase` |
| Constantes / enums | SCREAMING_SNAKE_CASE | `E_CONCLUIDO`, `MAX_REINTENTOS`, `TIPOS_POLIZA` |
| Campos de BD y parámetros de API | snake_case | `id_empresa`, `fh_pago`, `folio_fiscal` |
| Métodos privados de clase | prefijo `#` | `#buildResumen()`, `#validarPeriodo()` |
| Archivos de servicios | PascalCase + sufijo descriptivo | `ContpaqService.js`, `FechaUtils.js` |
| Archivos de use cases | PascalCase + `UseCase` | `ImportarPresupuestosUseCase.js` |
| Componentes de UI | PascalCase | `FacturasTable.jsx`, `DateRangePicker.vue` |

### Nombres que se explican solos

El nombre debe comunicar exactamente qué es o qué hace, sin necesidad de leer el cuerpo.

```js
// ✓ El nombre dice todo
async function getEmpresasSucursalesAccesiblesPorUsuario(userId) { ... }
const polizasConErrorEnGeneracion = polizas.filter(p => p.tieneError())

// ✗ Requiere leer el código para entender
async function getData(id) { ... }
const filtered = polizas.filter(p => p.status === 3)
```

### Idioma del nombre según el contexto

- **Dominio de negocio → español:** nombres de entidades, campos, variables del negocio: `poliza`, `sucursal`, `folio`, `id_cxp`.
- **Infraestructura y patrones → inglés:** capas, patrones, métodos genéricos: `execute()`, `findAll()`, `UseCase`, `Service`, `handleSubmit`.
- **Mensajes al usuario → español:** siempre, sin excepción.

---

## 7. Comentarios y documentación

### El comentario explica el POR QUÉ, nunca el QUÉ

El código ya dice qué hace. El comentario aporta la restricción no obvia, el contexto de negocio, o la razón del workaround.

```js
// ✓ Explica una restricción no obvia del negocio
// El nombre de la base proviene de la configuración de conexión (no es input del usuario).
const baseDatos = config.database

// ✓ Explica por qué no se detiene el flujo
// Si no existe acción contable, no aplica el proceso.
// No debe ser impedimento para que la operación principal continúe.
if (!accion?.id_poliza) return

// ✗ Describe el QUÉ — ya es obvio por el código
// Obtiene las empresas y sucursales
const [empresas, sucursales] = await Promise.all([...])
```

### JSDoc en funciones no triviales

Se documenta cuando el tipo o el comportamiento no son obvios por el nombre. Los tipos de dependencias externas se referencian con `import()` para no importar el módulo solo por el tipo.

```js
/**
 * Gestiona la cancelación contable de un documento.
 * - Mismo periodo que la póliza: cancela y genera nueva póliza con los documentos vigentes.
 * - Periodo posterior: genera póliza de reversión.
 *
 * @param {{ documento: import('sequelize').Model, id_accion: number, id_user: number }} params
 * @param {{ transaction?: import('sequelize').Transaction }} options
 * @returns {Promise<Poliza>}
 */
static async cancel({ documento, id_accion, id_user }, options = {}) { ... }
```

| Tag | Cuándo |
|---|---|
| `@param` | Cuando el tipo o el significado no son obvios por el nombre |
| `@returns` | Cuando retorna algo distinto a `void` |
| `@type` | En cada propiedad de un schema de validación |
| `@override` | Al sobreescribir un método de la clase base |
| `@description` | Para comportamientos con múltiples ramas o reglas de negocio importantes |

---

## 8. Refactorización

### Extraer cuando crece o se repite

Cuando un bloque de código crece demasiado o aparece en más de un lugar con el mismo propósito, se extrae a su propio archivo o función. El módulo original solo lo importa.

```js
// Antes: parseBodyFiltro vivía dentro del middleware
// Después de crecer: se movió a common/utils/parseBodyFiltro.js
// El middleware ahora solo lo importa
const { parseBodyFiltro } = require('../utils/parseBodyFiltro')
```

### Eliminar variables intermedias innecesarias

Si se pueden eliminar variables temporales sin perder legibilidad, se eliminan. Si no, se dejan pero con nombres que justifiquen su existencia.

```js
// ✓ Sin variable intermedia innecesaria
return polizas
    .filter(p => p.estaActiva())
    .map(p => p.getResumen())

// ✗ Variable que solo existe para hacer el return
const polizasActivas = polizas.filter(p => p.estaActiva())
const resumenes = polizasActivas.map(p => p.getResumen())
return resumenes
```

### Adaptar en lugar de crear

Antes de crear una nueva función o clase, se evalúa si la existente puede recibir un parámetro adicional para cubrir el nuevo caso.

```js
// ✓ Se extiende la función existente con un parámetro opcional
async function generarPoliza(documento, opciones = {}) {
    const { soloRegistrar = false } = opciones
    // ...
}

// ✗ Se duplica la función con una ligera variación
async function generarPolizaSinConcluir(documento) { ... }  // casi igual que la original
```

### Simplificar condicionales con `Promise.all`

Cuando hay múltiples `if/else` para manejar variantes de la misma operación asíncrona, se reemplaza con `Promise.all` y lógica posterior.

```js
// ✓ Ambas queries corren en paralelo, la lógica posterior decide
const [gastos, compras] = await Promise.all([
    Gasto.findAll({ where: { uuid_cxp } }),
    Compra.findAll({ where: { uuid_cxp } }),
])
const operaciones = [...gastos, ...compras].sort((a, b) => a.getFecha() - b.getFecha())

// ✗ Secuencial con if/else para algo que podría ser paralelo
let operaciones
const gastos = await Gasto.findAll({ where: { uuid_cxp } })
if (gastos.length > 0) {
    operaciones = gastos
} else {
    operaciones = await Compra.findAll({ where: { uuid_cxp } })
}
```

### Un método puede cambiar su valor de retorno

Si los callers necesitan el resultado de una operación, el método cambia de `void` a retornar la entidad. No se crean métodos paralelos solo para obtener algo que ya se generó.

```js
// ✓ El método retorna lo que creó — los callers que no lo necesitan lo ignoran
static async cancel(params, options) {
    // ...
    const poliza = await Poliza.cancelaPoliza(action.id_poliza, id_user, { transaction })
    return poliza   // antes era void
}
```

### No abstracciones por anticipado

Si el nuevo código solo filtra por una condición simple, se escribe simple. No se propone una clase base, un patrón genérico o un helper solo porque "podría reutilizarse en el futuro".

---

## 9. Commits

### Tres formatos según el origen

**Con ticket de tarea (SS-, N-, T-, S-):**
```
SS-188 Despliegue de gastos por cuenta contable de concepto y separación por documento
- fix(getIdentificador) Se soluciona detalle que previene que el identificador sea -null
```

```
S50.5 Detalle en el registro de acciones contables en pagos a proveedor
- refact(pagos-from-xml) Refactorización para generar el pago desde el método de creación
- feat(create-pago) Mejora para recibir un arreglo de operaciones sin depender de la cxp
- fix(archivo-pago) Se soluciona detalle de transacción al guardar el archivo del pago
```

**De rama técnica (sprint o rama sin ticket formal):**
```
48.14 fix(fecha-contable) Se soluciona detalle al evaluar si la fecha pertenecía al mismo periodo
```

**Fix o mejora puntual sin ticket:**
```
fix(match-modulos) Se soluciona detalle al localizar el identificador del módulo
- **Escenario**: Al importar configuración contable, el módulo era ignorado
- **Problema**: El mapper devolvía el id del módulo de pólizas en lugar del del sistema
```

**Versión:**
```
v24.0.13 - SS-188 Despliegue de gastos por cuenta contable de concepto y separación por documento
```

### Tipos de commit

| Tipo | Cuándo |
|---|---|
| `feat` | Nueva funcionalidad o endpoint |
| `fix` | Corrección de bug o comportamiento incorrecto |
| `refact` | Refactorización sin cambio de comportamiento |
| `hotfix` | Corrección urgente en producción |
| `chore` | Cambios menores: mensajes, renombres, comentarios sin impacto |
| `recovery` | Recuperar código eliminado por error |

### Reglas de escritura

- **El título** describe el escenario de negocio desde la perspectiva del usuario, no la operación técnica.  
  ✓ `"Cliente débito/crédito no separa sus importes dentro de la póliza"`  
  ✗ `"Fix en poliza_asiento.js línea 1027"`

- **Las líneas con guión** describen los cambios técnicos concretos: `- type(scope) descripción`.

- **Voz pasiva en español** para todas las descripciones técnicas:  
  Se soluciona · Se implementa · Se agrega · Se remueve · Se mejora · Se refactoriza · Se separa · Se centraliza · Se normaliza

- **Los tipos** (`feat`, `fix`, `refact`…) siempre en inglés.

- **El scope** es el nombre del método, módulo o archivo afectado, en kebab-case.

- Si el commit toca varios archivos con propósitos distintos, cada uno lleva su propia línea `- type(scope) descripción`.

---

## 10. Constantes sobre valores literales

Ningún número ni string "mágico" aparece inline en el código. Todo valor con significado de dominio se extrae a una constante nombrada, idealmente en un archivo dedicado.

```js
// ✗ Valor mágico inline
if (documento.status === 3) { ... }
const tipo = '01'

// ✓ Constante nombrada
const ESTADO = { CONCLUIDO: 'CONCLUIDO', CANCELADO: 'CANCELADO', PENDIENTE: 'PENDIENTE' }
if (documento.status === ESTADO.CONCLUIDO) { ... }

// ✓ Archivo dedicado para constantes de dominio
// catalogos/codigos-sat.js
export const CODIGOS_SAT = { PRODUCTO: '01', SERVICIO: '02', OTRO: '43' }
```

**Reglas:**
- Si el valor puede cambiar o aparece más de una vez: extráelo a una constante.
- Si pertenece a un catálogo del negocio (estados, tipos, códigos externos): va en un archivo propio.
- Los nombres de las constantes usan el dominio del negocio, no el tipo de dato.

---

## 11. Parámetros opcionales como objeto

Cuando una función necesita configuración adicional o parámetros que no siempre se usan, se agrupan en un único parámetro objeto al final, con valor por defecto `{}`. Nunca se usan múltiples parámetros posicionales opcionales.

```js
// ✗ Posicionales opcionales — difícil de leer, frágil de extender
async function procesar(id, transaction, soloValidar, notificar) { ... }

// ✓ Objeto de opciones con destructuring y defaults
async function procesar(id, opciones = {}) {
  const { transaction, soloValidar = false, notificar = true } = opciones
  ...
}

// La llamada es auto-documentada
await procesar(id, { soloValidar: true })
await procesar(id, { transaction, notificar: false })
await procesar(id) // caso base sin opciones
```

**Reglas:**
- Los parámetros requeridos van primero como posicionales normales.
- Los opcionales van siempre en el último parámetro `opciones = {}`.
- Cada opción tiene su propio default al desestructurar, no en la firma.
- Agregar una nueva opción nunca rompe a los callers existentes.

---

## 12. async/await siempre

Se usa `async/await` en todo el código asíncrono. Las cadenas `.then()` no se usan para lógica de negocio.

```js
// ✗ Cadena .then()
function obtenerDatos(id) {
  return repositorio.findById(id)
    .then(item => transformar(item))
    .then(item => guardar(item))
    .catch(err => manejarError(err))
}

// ✓ async/await
async function obtenerDatos(id) {
  const item = await repositorio.findById(id)
  const transformado = await transformar(item)
  return guardar(transformado)
}
```

**Por qué:** `async/await` mantiene el flujo legible como código síncrono, hace el manejo de errores con `try/catch` coherente con el resto del código, y elimina el anidamiento que acumula las cadenas `.then()`.
