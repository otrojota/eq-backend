# ZServer: generacion de ZModules

Este backend expone endpoints creando clases que extienden `ZModule`. Cada modulo registra sus rutas en `init()` y cada ruta se resuelve invocando un metodo de la misma clase.

## Estructura de un modulo

- Crear los modulos en `lib/`.
- Nombrar el archivo con PascalCase y el mismo nombre de la clase: `Usuarios.js`, `Dispositivos.js`, `Empresas.js`.
- Extender `ZModule` desde `./ZServer.js`.
- Importar el acceso a datos MongoDB desde `./MongoDB.js`.
- Exportar siempre una instancia singleton como `default`.

```js
import { ZModule } from "./ZServer.js";
import mongo from "./MongoDB.js";

class Usuarios extends ZModule {
    static get instance() {
        if (Usuarios._singleton) return Usuarios._singleton;
        Usuarios._singleton = new Usuarios();
        return Usuarios._singleton;
    }

    getOASTags() { return ["API para manejo de Usuarios"]; }

    init() {
        this.registerEndPoint("GET", "usuarios", this.getUsuarios);
        this.registerEndPoint("GET", "usuarios/:id", this.getUsuario);
        this.registerEndPoint("POST", "usuarios", this.creaUsuario);
        this.registerEndPoint("PUT", "usuarios/:id", this.actualizaUsuario);
        this.registerEndPoint("DELETE", "usuarios/:id", this.eliminaUsuario);
    }

    async getUsuarios() {
        const col = await mongo.collection("usuarios");
        return await col.find({}).toArray();
    }

    async getUsuario(id) {
        const col = await mongo.collection("usuarios");
        return await col.findOne({ _id: id });
    }

    async creaUsuario(usuario) {
        if (!usuario || !usuario.nombre) throw "ERR_USUARIO_INVALIDO";
        const col = await mongo.collection("usuarios");
        usuario._id = usuario._id || mongo.uuidv4();
        await col.insertOne(usuario);
        return usuario;
    }

    async actualizaUsuario(id, usuario) {
        if (!usuario) throw "ERR_USUARIO_INVALIDO";
        const col = await mongo.collection("usuarios");
        usuario._id = id;
        await col.replaceOne({ _id: id }, usuario, { upsert: true });
        return usuario;
    }

    async eliminaUsuario(id) {
        const col = await mongo.collection("usuarios");
        await col.deleteOne({ _id: id });
        return { id };
    }
}

export default Usuarios.instance;
```

## Registro en `index.js`

Importar el modulo y registrarlo despues de crear `ZServer`.

```js
import usuarios from "./lib/Usuarios.js";

// ...

let zServer = new ZServer(app, "/api/v1");
zServer.registerModule(usuarios);
```

El template incluye un ejemplo comentado:

```js
//zServer.registerModule(usuarios);
```

Al registrar el modulo, `ZServer` asigna `zServer` al modulo y llama automaticamente a `init()`.

## Registro de endpoints

Usar `registerEndPoint(httpMethod, path, method, oasOperation, authorization)`.

- `httpMethod`: `"GET"`, `"POST"`, `"PUT"` o `"DELETE"`.
- `path`: ruta relativa al prefijo del servidor. No comenzar con `/` salvo que sea necesario; ambas formas funcionan.
- `method`: referencia al metodo de la clase, por ejemplo `this.getUsuarios`.
- `oasOperation`: objeto opcional para complementar OpenAPI.
- `authorization`: funcion opcional para autorizacion.

Ejemplos:

```js
this.registerEndPoint("GET", "empresas/:rut/dispositivos", this.getDispositivos);
this.registerEndPoint("PUT", "empresas/:rut/dispositivos", this.setDispositivos);
```

## Resolucion de argumentos

ZServer inspecciona los nombres de argumentos del metodo y los llena automaticamente:

- Si el argumento coincide con un segmento `:param` de la ruta, viene desde `req.params`.
- En `GET` y `DELETE`, los argumentos que no son path params vienen desde query string.
- En `POST` y `PUT`, el primer argumento que no sea path param se toma desde el body JSON.
- Los argumentos especiales empiezan con `_`.

Argumentos especiales disponibles:

- `_request`: request original de Express.
- `_response`: response original de Express.
- `_bearerToken`: token `Authorization: Bearer ...` o cookie `bearerToken`.
- `_apiKey`: header `X-API-Key`.

Ejemplos:

```js
// GET /api/v1/usuarios/:id
async getUsuario(id) {}

// GET /api/v1/usuarios?texto=ana
async buscaUsuarios(texto) {}

// PUT /api/v1/usuarios/:id con body JSON
async actualizaUsuario(id, usuario) {}

// GET usando informacion de autenticacion
async getPerfil(_bearerToken) {}
```

Evitar renombrar parametros de forma ambigua: el nombre del argumento es parte del contrato del endpoint.

## Uso de MongoDB

El template inicializa MongoDB en `index.js` con `await mongo.init()`. Los modulos deben usar:

```js
const col = await mongo.collection("nombre_coleccion");
```

Operaciones comunes:

```js
await col.find({}).toArray();
await col.findOne({ _id: id });
await col.insertOne(doc);
await col.replaceOne({ _id: id }, doc, { upsert: true });
await col.updateOne({ _id: id }, { $set: cambios });
await col.deleteOne({ _id: id });
```

Para ids nuevos se puede usar:

```js
const id = mongo.uuidv4();
```

## Errores y respuestas

- Retornar objetos, arrays o valores serializables; ZServer responde JSON.
- Si un metodo no retorna nada, la respuesta sera `null`.
- Para errores de negocio, lanzar strings: `throw "ERR_USUARIO_INVALIDO"`. ZServer responde HTTP 400 con `{error}`.
- Para errores con status especifico, lanzar `{status, message}`.
- Errores no controlados responden HTTP 500 con `ERR_ERROR_INTERNO`.

## OpenAPI

`getOASTags()` agrupa endpoints en Swagger/OpenAPI:

```js
getOASTags() { return ["API para manejo de Usuarios"]; }
```

Se puede complementar la operacion con el cuarto argumento de `registerEndPoint`:

```js
this.registerEndPoint("GET", "usuarios/:id", this.getUsuario, {
    summary: "Obtiene un usuario por id"
});
```

### Como ZServer arma el contrato

`registerEndPoint` construye automaticamente una operacion OpenAPI:

- Convierte rutas Express como `usuarios/:id` a formato OpenAPI `usuarios/{id}`.
- Infere parametros `path` desde argumentos cuyo nombre coincide con `:param`.
- En `GET` y `DELETE`, infere argumentos no-path como parametros `query`.
- En `POST` y `PUT`, infere el primer argumento no-path como `requestBody`.
- Agrega respuestas base `200`, `400` y `500`.
- Agrega `tags` usando `getOASTags()`.
- Mezcla el cuarto argumento `oasOperation` sobre la operacion generada.

Los parametros inferidos tienen tipo `string` por defecto. Si se necesita otro tipo, descripcion, `required`, enum o schema, se debe reemplazar el parametro usando `oasOperation.parameters`.

Importante: `oasOperation.parameters` solo reemplaza parametros que ZServer ya pudo inferir por nombre. Si se declara un parametro en `oasOperation.parameters` pero no existe como argumento del metodo, ZServer lo ignora. Por eso los nombres de argumentos del metodo son parte del contrato.

Tambien importante: ZServer elimina internamente `oasOperation.parameters` despues de procesarlo. No reutilizar un mismo objeto `oasOperation` constante para multiples endpoints; crear el objeto inline o retornar uno nuevo desde una funcion.

Para esquemas reutilizables, llamar desde `init()`:

```js
this.oasDeclareSchema("Usuario", {
    type: "object",
    properties: {
        _id: { type: "string" },
        nombre: { type: "string" }
    }
});
```

Los schemas declarados quedan en `components.schemas` y se referencian con `$ref`:

```js
{ $ref: "#/components/schemas/Usuario" }
```

### Patron recomendado para endpoints documentados

Al generar un modulo, documentar siempre cada endpoint publico con:

- `summary`: descripcion corta.
- `description`: descripcion si hay reglas relevantes.
- `parameters`: path/query params con `schema`, `required` y `description`.
- `requestBody`: schema del body para `POST` y `PUT`.
- `responses`: al menos `200`, y errores de negocio esperados si aplica.

Ejemplo completo para una API REST de clientes:

```js
init() {
    this.oasDeclareSchema("Cliente", {
        type: "object",
        required: ["rut", "nombre"],
        properties: {
            rut: { type: "string", description: "RUT del cliente" },
            nombre: { type: "string", description: "Nombre del cliente" }
        }
    });

    this.registerEndPoint("GET", "clientes", this.getClientes, {
        summary: "Lista clientes",
        responses: {
            "200": {
                description: "Lista de clientes",
                content: {
                    "application/json": {
                        schema: {
                            type: "array",
                            items: { $ref: "#/components/schemas/Cliente" }
                        }
                    }
                }
            }
        }
    });

    this.registerEndPoint("GET", "clientes/:rut", this.getCliente, {
        summary: "Obtiene un cliente por RUT",
        parameters: [
            {
                name: "rut",
                in: "path",
                required: true,
                description: "RUT del cliente",
                schema: { type: "string" }
            }
        ],
        responses: {
            "200": {
                description: "Cliente encontrado",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/Cliente" }
                    }
                }
            },
            "404": { description: "Cliente no encontrado" }
        }
    });

    this.registerEndPoint("POST", "clientes", this.creaCliente, {
        summary: "Crea un cliente",
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/Cliente" }
                }
            }
        },
        responses: {
            "200": {
                description: "Cliente creado",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/Cliente" }
                    }
                }
            }
        }
    });

    this.registerEndPoint("PUT", "clientes/:rut", this.actualizaCliente, {
        summary: "Actualiza un cliente",
        parameters: [
            {
                name: "rut",
                in: "path",
                required: true,
                description: "RUT del cliente",
                schema: { type: "string" }
            }
        ],
        requestBody: {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/Cliente" }
                }
            }
        },
        responses: {
            "200": {
                description: "Cliente actualizado",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/Cliente" }
                    }
                }
            }
        }
    });

    this.registerEndPoint("DELETE", "clientes/:rut", this.eliminaCliente, {
        summary: "Elimina un cliente",
        parameters: [
            {
                name: "rut",
                in: "path",
                required: true,
                description: "RUT del cliente",
                schema: { type: "string" }
            }
        ],
        responses: {
            "200": {
                description: "Cliente eliminado",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                rut: { type: "string" }
                            }
                        }
                    }
                }
            }
        }
    });
}
```

Metodos correspondientes:

```js
async getClientes() {}
async getCliente(rut) {}
async creaCliente(cliente) {}
async actualizaCliente(rut, cliente) {}
async eliminaCliente(rut) {}
```

Observar que `rut` y `cliente` existen como argumentos. Eso permite que ZServer pueda inferir path/body antes de mezclar la documentacion.

## Convenciones

- Clases y archivos de modulo: PascalCase singular o plural segun dominio (`Usuario.js`, `Usuarios.js`, `Dispositivos.js`).
- Instancia exportada: default singleton (`export default Usuarios.instance`).
- Colecciones MongoDB: minusculas, plural y sin espacios (`usuarios`, `dispositivos`, `empresas`).
- Endpoints REST: minusculas, plural y con guiones si hace falta (`usuarios`, `tipos-base`, `all-variables`).
- Parametros path: nombres cortos y semanticos (`:id`, `:rut`, `:codigo`).
- Metodos GET: `getRecurso`, `getRecursos`, `buscaRecursos`.
- Metodos POST: `creaRecurso`.
- Metodos PUT: `actualizaRecurso`, `setRecursos` cuando reemplaza una coleccion completa.
- Metodos DELETE: `eliminaRecurso`.
- Codigos de error: strings en mayusculas con prefijo `ERR_`.

## Checklist para generar un ZModule

1. Crear `lib/NombreModulo.js`.
2. Importar `ZModule` y `mongo`.
3. Implementar singleton `static get instance()`.
4. Implementar `getOASTags()`.
5. Declarar schemas OpenAPI con `oasDeclareSchema()`.
6. Registrar endpoints en `init()` con `registerEndPoint`.
7. Documentar cada endpoint con el cuarto argumento `oasOperation`.
8. Implementar metodos async usando argumentos con nombres que coincidan con ruta/query/body.
9. Validar entradas y lanzar errores `ERR_*` para errores de negocio.
10. Exportar `NombreModulo.instance`.
11. Importar y registrar el modulo en `index.js` con `zServer.registerModule(nombreModulo)`.
