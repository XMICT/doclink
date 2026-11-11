# Estilo de Commits — xmict

Formato de referencia para Claude. **Cada commit debe seguir estas reglas sin excepción.**

---

## Tres formatos según el origen

**Con ticket (SS-, N-, T-, S-):**
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

**De rama técnica sin ticket formal:**
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

---

## Tipos

| Tipo | Cuándo |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `refact` | Refactorización sin cambio de comportamiento |
| `hotfix` | Corrección urgente en producción |
| `chore` | Cambios menores: mensajes, renombres, comentarios sin impacto |
| `recovery` | Recuperar código eliminado por error |

---

## Reglas

- **El título** describe el escenario de negocio desde la perspectiva del usuario, no la operación técnica.  
  ✓ `"Cliente débito/crédito no separa sus importes dentro de la póliza"`  
  ✗ `"Fix en poliza_asiento.js línea 1027"`

- **Las líneas con guión** usan siempre el formato `- type(scope) descripción`.

- **Voz pasiva en español** para descripciones técnicas:  
  Se soluciona · Se implementa · Se agrega · Se remueve · Se mejora · Se refactoriza · Se separa · Se centraliza · Se normaliza

- **Los tipos** siempre en inglés (`feat`, `fix`, `refact`…).

- **El scope** es el nombre del método, módulo o archivo afectado, en kebab-case.

- Si el commit toca varios archivos con propósitos distintos, cada cambio lleva su propia línea `- type(scope) descripción`.
