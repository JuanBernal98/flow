---
name: flow-review
description: Revisa una rama o un MR (de otra persona o mío) contra el alcance de su ticket de YouTrack, que es la fuente de verdad, qué criterios de aceptación cumple o no y qué hace fuera del ticket, y después bugs y simplificaciones obvias, sin tocar git, GitLab ni YouTrack. Úsalo cuando llegue un evento "flow request: review <ID> [!<iid>]" del watcher, o cuando el usuario pida revisar un ticket o un MR.
argument-hint: "<ID> [!<iid>]"
context: fork
---

Revisa el código del ticket de `<argumentos>` contra lo que pide el ticket. Responde en español.

**El ticket es la fuente de verdad; el código es lo que se revisa.** Qué hay que conseguir y cuándo está
terminado sale del ticket (descripción, padre, Notion y comentarios). El código puede estar mal, incompleto
o hacer más de lo pedido, sea de otra persona o mío: nunca lo uses para reinterpretar el ticket. Si no
coinciden, el que falla es el código, salvo que el ticket sea ambiguo; en ese caso dilo como pregunta.

Solo lectura: no cambies de rama, no hagas stash, no comentes ni apruebes en GitLab y no muevas el ticket.
Lo que se publique lo decide el usuario.

`<argumentos>` trae un ID con forma `^[A-Z]+-[0-9]+` y, si el código ya tiene MR, su número como `!<iid>`.
Sin ID, dilo y para: sin ticket no hay con qué comparar.

## 1. Ticket

Lee el ticket con los pasos 1 y 3 de `flow-ticket-context` (`~/.local/bin/flow skill show flow-ticket-context`):
ticket, padre, Notion y `AGENTS.md`, y escribe o refresca su overview. Quédate con `todo` y `acceptance`:
son la lista contra la que mides el código.

## 2. Código

- **Con `!<iid>`**: `glab mr view <iid> --comments` para la descripción y las discusiones abiertas, y
  `glab mr diff <iid>` para el cambio. Si `glab` no está autenticado (`glab auth status`), dilo y para.
- **Sin MR** (mi rama antes de abrirlo): busca la rama del ticket, `<ID>` o `<ID>-…`, local o en `origin`.
  Su base es `git config branch.<rama>.flowBase` si existe, si no `origin/main`. Lee
  `git log --oneline <base>..<rama>` y `git diff <base>...<rama>`; si es la rama actual, suma también los
  cambios sin commitear (`git diff HEAD`). Sin rama, dilo y para.

Lee los archivos tocados enteros cuando el diff no baste para entender el cambio, y los `AGENTS.md` de sus
rutas.

## 3. Resumen

Breve, como respuesta final (es lo único que verá la conversación principal):

- **Qué**: `ID — summary` del ticket y `!<iid> — título` del MR (o la rama), con sus enlaces.
- **Contra el ticket**: cada punto de `acceptance` (y de `todo` que no cubra) con ✅ cumplido, ❌ falta o
  está mal, o ❔ no se puede comprobar leyendo el código; una línea de por qué y, si aplica, `ruta:línea`.
- **Fuera del ticket**: lo que el código hace y el ticket no pide.
- **Problemas**: bugs, casos límite y riesgos, del más grave al menos, con `ruta:línea`. No listes estilo
  ni gustos personales.
- **Simplificaciones** (secundario): solo quick wins obvios en el código que cambia el MR, como
  duplicación clara, código muerto, una utilidad del repo que ya hace lo mismo o una condición que se
  puede quitar. Cada uno con `ruta:línea` y el cambio en una frase. Máximo 3-5; si no hay nada claro,
  omite la sección. Nada de refactors grandes ni de gustos personales.
- **Discusiones abiertas** del MR que sigan sin resolver, si las hay.
- **Veredicto**: una frase; ¿cumple el ticket o qué falta para cumplirlo?

No implementes nada.
