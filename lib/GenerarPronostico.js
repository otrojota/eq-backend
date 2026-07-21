import ZClient from "./ZClient.js";
import mongo from "./MongoDB.js";
import Proceso from "./Proceso.js";
const URL_MODELOS = process.env.URL_MODELOS || "http://localhost:8152";
class GenerarPronostico extends Proceso {
    static get instance() { return GenerarPronostico._singleton ||= new GenerarPronostico(); }
    get codigo() { return "generar-pronostico"; }
    get nombre() { return "Generar Pronostico"; }
    get descripcion() { return "Genera eventos agregados probabilisticos por placa"; }
    async ejecuta(options = {}) { return await this.ejecutaAsync(options); }
    async ejecutaAsync(options = {}) {
        const activa = await this.getEjecucionActiva(); if (activa) return { estado: "omitida", ejecucionId: activa._id, mensaje: "Proceso ya en ejecucion" };
        const ahora = new Date().toISOString(); const ejecucion = { _id: mongo.uuidv4(), codigo: this.codigo, nombre: this.nombre, descripcion: this.descripcion, estado: "ejecutando", inicioUTC: ahora, terminoUTC: null, options: options || {}, actualizadoUTC: ahora, logs: [] };
        await (await mongo.collection("ejecucionProceso")).insertOne(ejecucion);
        try { await new ZClient(`${URL_MODELOS}/api/v1`).post(`/ejecucion-proceso/${this.codigo}/run/${ejecucion._id}`, { options: options || {} }); return { estado: "ejecutando", ejecucionId: ejecucion._id }; }
        catch (error) { this.ejecucionId = ejecucion._id; await this.falla(error); this.ejecucionId = null; throw error; }
    }
}
export default Proceso.registra(GenerarPronostico.instance);
