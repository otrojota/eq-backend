import ZClient from "./ZClient.js";
import mongo from "./MongoDB.js";
import Proceso from "./Proceso.js";

const URL_MODELOS = process.env.URL_MODELOS || "http://localhost:8152";

class ProcesaTembloresDescargados extends Proceso {
    static get instance() {
        if (ProcesaTembloresDescargados._singleton) return ProcesaTembloresDescargados._singleton;
        ProcesaTembloresDescargados._singleton = new ProcesaTembloresDescargados();
        return ProcesaTembloresDescargados._singleton;
    }

    get codigo() {
        return "procesa-temblores-descargados";
    }

    get nombre() {
        return "Procesa Temblores Descargados";
    }

    get descripcion() {
        return "Procesa en modelos los temblores descargados pendientes de analisis";
    }

    async ejecuta(options = {}) {
        return await this.ejecutaAsync(options);
    }

    async ejecutaAsync(options = {}) {
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
}

export default Proceso.registra(ProcesaTembloresDescargados.instance);
