import ZClient from "./ZClient.js";
import mongo from "./MongoDB.js";
import Proceso from "./Proceso.js";

const URL_MODELOS = process.env.URL_MODELOS || "http://localhost:8152";

class Clusteriza extends Proceso {
    static get instance() {
        if (Clusteriza._singleton) return Clusteriza._singleton;
        Clusteriza._singleton = new Clusteriza();
        return Clusteriza._singleton;
    }

    get codigo() {
        return "clusteriza";
    }

    get nombre() {
        return "Clusteriza Eventos Agregados";
    }

    get descripcion() {
        return "Reconoce clusters de temblores validos por placa y mantiene la coleccion eventos_agregados";
    }

    async ejecuta(options = {}) {
        return await this.ejecutaAsync(options);
    }

    async ejecutaAsync(options = {}) {
        options = this.normalizaOptions(options);
        const ejecucionActiva = await this.getEjecucionActiva();
        if (ejecucionActiva) {
            return { estado: "omitida", mensaje: "Proceso ya en ejecucion", ejecucionId: ejecucionActiva._id };
        }

        const ejecucion = await this.creaEjecucion(options);
        try {
            const modelos = new ZClient(`${URL_MODELOS}/api/v1`);
            await modelos.post(`/ejecucion-proceso/${this.codigo}/run/${ejecucion._id}`, { options });
            return { estado: "ejecutando", ejecucionId: ejecucion._id };
        } catch (error) {
            this.ejecucionId = ejecucion._id;
            await this.falla(error);
            this.ejecucionId = null;
            throw error;
        }
    }

    async creaEjecucion(options = {}) {
        const ahora = new Date().toISOString();
        const ejecucion = {
            _id: mongo.uuidv4(),
            codigo: this.codigo,
            nombre: this.nombre,
            descripcion: this.descripcion,
            estado: "ejecutando",
            inicioUTC: ahora,
            terminoUTC: null,
            ultimoError: null,
            options,
            actualizadoUTC: ahora,
            logs: []
        };
        const col = await mongo.collection("ejecucionProceso");
        await col.insertOne(ejecucion);
        return ejecucion;
    }

    normalizaOptions(options = {}) {
        if (options && options.options && Object.keys(options).length === 1) return options.options || {};
        return options || {};
    }
}

export default Proceso.registra(Clusteriza.instance);
