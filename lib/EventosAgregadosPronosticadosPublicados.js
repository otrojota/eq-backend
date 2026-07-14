import { ZModule } from "./ZServer.js";
import mongo from "./MongoDB.js";

class EventosAgregadosPronosticadosPublicados extends ZModule {
    static get instance() { return EventosAgregadosPronosticadosPublicados._singleton ||= new EventosAgregadosPronosticadosPublicados(); }
    getOASTags() { return ["Eventos Agregados Pronosticados Publicados"]; }
    init() {
        this.registerEndPoint("GET", "eventos-agregados-pronosticados-publicados", this.getPublicados, {summary:"Lista de pronosticos publicables consolidados"});
        this.registerEndPoint("GET", "eventos-agregados-pronosticados-publicados/puntos", this.getPuntos, {summary:"Puntos de pronosticos publicables"});
        this.registerEndPoint("GET", "eventos-agregados-pronosticados-publicados/:id", this.getPublicado, {summary:"Obtiene un pronostico publicable"});
    }
    async getPublicados(codigoPlaca, pronosticoId, vigente) {
        const ayer=new Date(); ayer.setUTCHours(0,0,0,0); ayer.setUTCDate(ayer.getUTCDate()-1);
        const q={tiempoMedio:{$gte:ayer.getTime()}};
        if(codigoPlaca)q.placasAsociadas=codigoPlaca;
        if(pronosticoId)q.pronosticoId=pronosticoId;
        q.vigente=vigente===undefined||vigente===null||vigente===""?true:String(vigente)==="true";
        return await (await mongo.collection("eventos_agregados_pronosticados_publicados")).find(q).sort({tiempoMedio:1,orden:1}).toArray();
    }
    async getPuntos(codigoPlaca, desde, hasta, vigente, historico) {
        const q={};
        if(String(historico)!=="true"){
            const ayer=new Date(); ayer.setUTCHours(0,0,0,0); ayer.setUTCDate(ayer.getUTCDate()-1);
            q.vigente=true; q.tiempoMedio={$gte:ayer.getTime()};
        } else {
            const tiempo={}; if(desde!==undefined&&desde!==null&&desde!=="")tiempo.$gte=this.parseTiempo(desde); if(hasta!==undefined&&hasta!==null&&hasta!=="")tiempo.$lte=this.parseTiempo(hasta);
            if(Object.keys(tiempo).length)q.tiempoMedio=tiempo;
            if(vigente!==undefined&&vigente!==null&&vigente!=="")q.vigente=String(vigente)==="true";
        }
        if(codigoPlaca)q.placasAsociadas=codigoPlaca;
        return await (await mongo.collection("eventos_agregados_pronosticados_publicados")).aggregate([{$match:q},{$sort:{tiempoMedio:1,orden:1}},{$project:{_id:1,pronosticoId:1,tipo:1,codigoPlaca:1,placasOrigen:1,placasAsociadas:1,orden:1,vigente:1,tiempo:"$tiempoMedio",latitud:"$ubicacion.punto.latitud",longitud:"$ubicacion.punto.longitud",energia:"$energiaAcumulada.p50",radioKm:"$radioDistribucionKm.p50"}}]).toArray();
    }
    parseTiempo(v){const n=Number(v);if(Number.isFinite(n))return n;const t=Date.parse(v);if(Number.isNaN(t))throw "ERR_FECHA_INVALIDA";return t;}
    async getPublicado(id){const d=await(await mongo.collection("eventos_agregados_pronosticados_publicados")).findOne({_id:id});if(!d)throw{status:404,message:"ERR_PRONOSTICO_PUBLICADO_NO_ENCONTRADO"};return d;}
}
export default EventosAgregadosPronosticadosPublicados.instance;
