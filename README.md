# Gestor personal de suscripciones

Aplicación privada para administrar suscripciones compartidas en bolivianos (BOB). El panel muestra cobros recibidos, gastos pagados, resultado de caja, margen sobre cargos emitidos y saldos por cobrar. Los importes se guardan en centavos. Los combos distribuyen su precio entre sus suscripciones al emitir los cargos.

## Requisitos

- Node.js 24 o superior y pnpm 11.20.0. Si usas Corepack, ejecuta `corepack enable` para activar la versión indicada en `package.json`.
- Una cuenta de Cloudflare para el despliegue. Puedes empezar con la dirección `workers.dev` y agregar un dominio propio después. En local no necesitas una cuenta de Cloudflare ni una base de datos remota.
- Ejecuta todos los comandos desde la raíz del repositorio.

## Ejecutar en local

Instala las dependencias y arranca el Worker con la interfaz compilada:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Abre `http://127.0.0.1:8787`. `pnpm dev` aplica las migraciones pendientes a una D1 local y sirve frontend y API desde el mismo origen. La base local persiste en `.wrangler/state` entre reinicios. El acceso local funciona únicamente desde `localhost` o `127.0.0.1`. Detén el proceso con Ctrl+C.

Para editar la interfaz con recarga automática, mantén `pnpm dev` activo y abre una segunda terminal:

```bash
pnpm dev:web
```

Abre la dirección que anuncie Vite, normalmente `http://127.0.0.1:5173`. Vite envía las solicitudes `/api` al Worker del puerto 8787. Si el puerto 5173 está ocupado, usa el nuevo puerto que muestre la terminal. Los cambios de la API se actualizan en el Worker. Para ver los cambios de React en el puerto 8787, vuelve a ejecutar `pnpm build` o reinicia `pnpm dev`.

Comprueba el proyecto con:

```bash
pnpm typecheck
pnpm test
pnpm build
```

En la aplicación, crea primero un servicio, una suscripción y una persona en **Catálogo**. Luego registra gastos, cargos y abonos desde **Resumen → Registrar movimiento**.

## Desplegar en Cloudflare

1. Inicia sesión y crea la base D1:

   ```bash
   pnpm exec wrangler login
   pnpm exec wrangler d1 create gestor-suscripciones
   ```

   Copia el `database_id` que devuelve el segundo comando en la entrada `DB` de `wrangler.jsonc`. Sustituye el valor inicial `00000000-0000-0000-0000-000000000000`.

2. El proyecto tiene `workers_dev: true`, así que Cloudflare le asigna una dirección `workers.dev` al desplegar. Si tienes un dominio propio en Cloudflare, puedes añadir esta propiedad al nivel superior de `wrangler.jsonc`, junto a `workers_dev`:

   ```json
   "routes": [{ "pattern": "suscripciones.ejemplo.com", "custom_domain": true }]
   ```

   Sustituye el ejemplo por tu dominio real. El Worker servirá la interfaz y la API bajo ese mismo dominio. Las URL de vista previa están desactivadas. [Dominios personalizados de Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

3. Al crear el Worker, activa **Protect with Cloudflare Access**, selecciona **All traffic** y una política **Allow** limitada a tu correo exacto. Esto protege las direcciones del Worker, incluida `workers.dev`. También puedes hacerlo después en **Workers & Pages → tu Worker → Access**. Copia el **Application Audience (AUD) Tag** desde la aplicación de Access creada e identifica el host de tu equipo, por ejemplo `equipo.cloudflareaccess.com`. [Access para Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

4. Aplica las migraciones a la D1 remota y publica el Worker:

   ```bash
   pnpm exec wrangler d1 migrations apply DB --remote
   pnpm deploy
   ```

5. Introduce los tres valores de Access cuando Wrangler los solicite. `ACCESS_TEAM_DOMAIN` lleva únicamente el host, sin `https://` ni una barra final. `ADMIN_EMAIL` debe coincidir con el correo autorizado. Wrangler guarda estos valores fuera del repositorio:

   ```bash
   pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN
   pnpm exec wrangler secret put ACCESS_AUD
   pnpm exec wrangler secret put ADMIN_EMAIL
   ```

   El Worker exige un JWT firmado por Access para entregar tanto la interfaz como la API. Hasta introducir los tres valores responde con acceso denegado. Abre la dirección publicada, inicia sesión con el correo permitido y comprueba que cargue **Resumen**. [Validación de JWT de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

Para publicar cambios posteriores, aplica primero las migraciones nuevas con `pnpm exec wrangler d1 migrations apply DB --remote` y ejecuta `pnpm deploy`. Revisa el resultado con `pnpm typecheck` y `pnpm test` antes de publicar.

## Respaldo y restauración

Crea un respaldo SQL de D1 desde la raíz del repositorio:

```bash
mkdir -p backups
pnpm exec wrangler d1 export DB --remote --output backups/respaldo.sql
```

`backups/` está excluido de Git. Guarda una copia en un lugar privado. Para restaurar, crea una **D1 nueva y vacía** desde Cloudflare, importa el archivo y comprueba los saldos antes de apuntar el `database_id` del Worker a esa base:

```bash
pnpm exec wrangler d1 execute NOMBRE_DE_LA_NUEVA_DB --remote --file backups/respaldo.sql
```

La exportación y restauración se verificaron en D1 local, incluidos combos, pagos parciales y restricciones de la base. [Exportación e importación de D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## Bóveda de contraseñas

La bóveda pide una frase maestra independiente de Cloudflare Access. El navegador deriva una clave con PBKDF2-SHA-256 y cifra cada contraseña con AES-256-GCM. D1 guarda la información cifrada. Para recuperar contraseñas tras una restauración necesitas **el respaldo de D1 y la misma frase maestra**. Guarda esa frase en un lugar seguro antes de registrar credenciales.
# my-subscriptions
