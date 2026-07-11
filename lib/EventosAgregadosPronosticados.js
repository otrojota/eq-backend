import { ZModule } from "./ZServer.js";
import mongo from "./MongoDB.js";
class EventosAgregadosPronosticados extends ZModule {
    static get instance() { return EventosAgregadosPronosticados._singleton ||= new EventosAgregadosPronosticados(); }
    getOASTags() { return ["Eventos Agregados Pronosticados"]; }
    init() {
        this.registerEndPoint("GET", "eventos-agregados-pronosticados", this.getPronosticos, { summary: "Lista eventos agregados pronosticados" });
        this.registerEndPoint("GET", "eventos-agregados-pronosticados/puntos", this.getPuntos, { summary: "Lista puntos de pronosticos vigentes" });
        this.registerEndPoint("GET", "eventos-agregados-pronosticados/:id", this.getPronostico, { summary: "Obtiene un evento agregado pronosticado" });
    }
    async getPronosticos(codigoPlaca, pronosticoId, vigente) {
        const ayer = new Date(); ayer.setUTCHours(0, 0, 0, 0); ayer.setUTCDate(ayer.getUTCDate() - 1);
        const q = { tiempoMedio: { $gte: ayer.getTime() } }; if (codigoPlaca) q.codigoPlaca = codigoPlaca; if (pronosticoId) q.pronosticoId = pronosticoId; q.vigente = vigente === undefined || vigente === null || vigente === "" ? true : String(vigente) === "true";
        return await (await mongo.collection("eventos_agregados_pronosticados")).find(q).sort({ codigoPlaca: 1, orden: 1 }).toArray();
    }
    async getPuntos(codigoPlaca) {
        const ayer = new Date(); ayer.setUTCHours(0, 0, 0, 0); ayer.setUTCDate(ayer.getUTCDate() - 1);
        const q = { vigente: true, tiempoMedio: { $gte: ayer.getTime() } }; if (codigoPlaca) q.codigoPlaca = codigoPlaca;
        return await (await mongo.collection("eventos_agregados_pronosticados")).aggregate([{ $match: q }, { $sort: { codigoPlaca: 1, orden: 1 } }, { $project: { _id: 1, pronosticoId: 1, codigoPlaca: 1, orden: 1, tiempo: "$tiempoMedio", latitud: "$ubicacion.punto.latitud", longitud: "$ubicacion.punto.longitud", energia: "$energiaAcumulada.p50", probabilidadBorde: "$ubicacion.probabilidadBorde" } }]).toArray();
    }
    async getPronostico(id) { const d = await (await mongo.collection("eventos_agregados_pronosticados")).findOne({ _id: id }); if (!d) throw { status: 404, message: "ERR_PRONOSTICO_NO_ENCONTRADO" }; return d; }
}
export default EventosAgregadosPronosticados.instance;
