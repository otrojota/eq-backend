import mongo from "./MongoDB.js";

class Proceso {
    static _procesos = new Map();

    static registra(proceso) {
        if (!proceso || !proceso.codigo) throw "ERR_PROCESO_INVALIDO";
        Proceso._procesos.set(proceso.codigo, proceso);
        return proceso;
    }

    static getProceso(codigo) {
        return Proceso._procesos.get(codigo);
    }

    static getProcesos() {
        return Array.from(Proceso._procesos.values());
    }

    get codigo() {
        throw "ERR_PROCESO_SIN_CODIGO";
    }

    get nombre() {
        return this.codigo;
    }

    get descripcion() {
        return "";
    }

    async run() {
        throw "ERR_PROCESO_SIN_RUN";
    }

    async ejecuta(options = {}) {
        const ejecucionActiva = await this.getEjecucionActiva();
        if (ejecucionActiva) {
            return { estado: "omitida", mensaje: "Proceso ya en ejecucion", ejecucionId: ejecucionActiva._id };
        }

        const ejecucion = await this.inicia(options);
        try {
            const resultado = await this.run(options);
            await this.finaliza(resultado);
            return { estado: "ok", ejecucionId: ejecucion._id, resultado };
        } catch (error) {
            await this.falla(error);
            throw error;
        } finally {
            this.ejecucionId = null;
        }
    }

    async ejecutaAsync(options = {}) {
        const ejecucionActiva = await this.getEjecucionActiva();
        if (ejecucionActiva) {
            return { estado: "omitida", mensaje: "Proceso ya en ejecucion", ejecucionId: ejecucionActiva._id };
        }

        const ejecucion = await this.inicia(options);
        setTimeout(async () => {
            try {
                const resultado = await this.run(options);
                await this.finaliza(resultado);
            } catch (error) {
                await this.falla(error);
            } finally {
                this.ejecucionId = null;
            }
        }, 0);
        return { estado: "ejecutando", ejecucionId: ejecucion._id };
    }

    async getEstado() {
        return await this.getEjecucionActiva();
    }

    async getEjecucionActiva() {
        const col = await mongo.collection("ejecucionProceso");
        return await col.findOne({
            codigo: this.codigo,
            estado: { $in: ["ejecutando", "deteniendo"] }
        });
    }

    async inicia(options = {}) {
        const ahora = new Date();
        const ejecucion = {
            _id: mongo.uuidv4(),
            codigo: this.codigo,
            nombre: this.nombre,
            descripcion: this.descripcion,
            estado: "ejecutando",
            inicioUTC: ahora.toISOString(),
            terminoUTC: null,
            ultimoError: null,
            options,
            actualizadoUTC: ahora.toISOString(),
            logs: []
        };
        const col = await mongo.collection("ejecucionProceso");
        await col.insertOne(ejecucion);
        this.ejecucionId = ejecucion._id;
        await this.logInfo("Proceso iniciado");
        return ejecucion;
    }

    async finaliza(resultado) {
        const ahora = new Date();
        await this.logInfo("Proceso finalizado");
        const estado = await this.calculaEstadoFinal();
        const col = await mongo.collection("ejecucionProceso");
        await col.updateOne(
            { _id: this.ejecucionId },
            {
                $set: {
                    estado,
                    terminoUTC: ahora.toISOString(),
                    resultado: resultado || null,
                    actualizadoUTC: ahora.toISOString()
                }
            }
        );
    }

    async falla(error) {
        const ahora = new Date();
        const mensaje = this.errorToString(error);
        await this.logError(mensaje, error?.stack || null);
        const col = await mongo.collection("ejecucionProceso");
        await col.updateOne(
            { _id: this.ejecucionId },
            {
                $set: {
                    estado: "error",
                    terminoUTC: ahora.toISOString(),
                    ultimoError: mensaje,
                    actualizadoUTC: ahora.toISOString()
                }
            },
            { upsert: false }
        );
    }

    async verificaDetencionSolicitada() {
        if (!this.ejecucionId) return;
        const col = await mongo.collection("ejecucionProceso");
        const ejecucion = await col.findOne(
            { _id: this.ejecucionId },
            { projection: { estado: 1 } }
        );
        if (ejecucion?.estado == "deteniendo") {
            throw new Error("Proceso detenido por el usuario");
        }
    }

    async logDebug(mensaje, detalle = null) {
        await this.log("debug", mensaje, detalle);
    }

    async logInfo(mensaje, detalle = null) {
        await this.log("info", mensaje, detalle);
    }

    async logWarning(mensaje, detalle = null) {
        await this.log("warning", mensaje, detalle);
    }

    async logError(mensaje, detalle = null) {
        await this.log("error", mensaje, detalle);
    }

    async log(tipo, mensaje, detalle = null) {
        if (!this.ejecucionId) return;
        const ahora = new Date();
        const log = {
            fechaUTC: ahora.toISOString(),
            tipo,
            mensaje: this.errorToString(mensaje),
            detalle
        };
        const col = await mongo.collection("ejecucionProceso");
        await col.updateOne(
            { _id: this.ejecucionId },
            {
                $set: {
                    codigo: this.codigo,
                    nombre: this.nombre,
                    descripcion: this.descripcion,
                    ultimoLogUTC: log.fechaUTC,
                    actualizadoUTC: log.fechaUTC
                },
                $push: { logs: log }
            },
            { upsert: false }
        );
        this.logConsola(log);
    }

    async calculaEstadoFinal() {
        const col = await mongo.collection("ejecucionProceso");
        const ejecucion = await col.findOne(
            { _id: this.ejecucionId },
            { projection: { logs: 1 } }
        );
        const logs = ejecucion?.logs || [];
        if (logs.some(log => log.tipo == "error")) return "error";
        if (logs.some(log => log.tipo == "warning")) return "warning";
        return "ok";
    }

    logConsola(log) {
        const texto = `[${this.codigo}] [${log.tipo}] ${log.mensaje}`;
        if (log.tipo == "error") console.error(texto);
        else if (log.tipo == "warning") console.warn(texto);
        else console.log(texto);
    }

    errorToString(error) {
        if (error === undefined || error === null) return "";
        if (typeof error == "string") return error;
        if (error.message) return error.message;
        return error.toString();
    }
}

export default Proceso;
