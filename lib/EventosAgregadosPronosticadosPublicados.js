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
    async getPublicados(codigoPlaca, pronosticoId, vigente, estado) {
        const q={};
        if(codigoPlaca)q.placasAsociadas=codigoPlaca;
        if(pronosticoId)q.pronosticoId=pronosticoId;
        if(estado)q.estado=estado;
        else q.vigente=vigente===undefined||vigente===null||vigente===""?true:String(vigente)==="true";
        return await (await mongo.collection("eventos_agregados_pronosticados_publicados")).find(q).sort({tiempoMedio:1,orden:1}).toArray();
    }
    async getPuntos(codigoPlaca, desde, hasta, vigente, historico) {
        const q={};
        if(String(historico)!=="true"){
            q.$or=[{estado:"abierto"},{estado:{$exists:false},vigente:true}];
        } else {
            const desdeTiempo=desde!==undefined&&desde!==null&&desde!==""?this.parseTiempo(desde):null;
            const hastaTiempo=hasta!==undefined&&hasta!==null&&hasta!==""?this.parseTiempo(hasta):null;
            if(hastaTiempo!==null)q.tiempoInicioEstimado={$lte:hastaTiempo};
            if(desdeTiempo!==null)q.tiempoFinEstimado={$gte:desdeTiempo};
            if(vigente!==undefined&&vigente!==null&&vigente!=="")q.vigente=String(vigente)==="true";
        }
        if(codigoPlaca)q.placasAsociadas=codigoPlaca;
        return await (await mongo.collection("eventos_agregados_pronosticados_publicados")).aggregate([{$match:q},{$sort:{tiempoMedio:1,orden:1}},{$project:{_id:1,pronosticoId:1,tipo:1,codigoPlaca:1,placasOrigen:1,placasAsociadas:1,orden:1,estado:1,vigente:1,creadoUTC:1,actualizadoUTC:1,cerradoUTC:1,cantidadActualizaciones:1,motivoCierre:1,tiempo:"$tiempoMedio",tiempoInicioEstimado:1,tiempoFinEstimado:1,latitud:"$ubicacion.punto.latitud",longitud:"$ubicacion.punto.longitud",energia:"$energiaAcumulada.p50",radioKm:"$radioDistribucionKm.p50"}}]).toArray();
    }
    parseTiempo(v){const n=Number(v);if(Number.isFinite(n))return n;const t=Date.parse(v);if(Number.isNaN(t))throw "ERR_FECHA_INVALIDA";return t;}
    async getPublicado(id){const d=await(await mongo.collection("eventos_agregados_pronosticados_publicados")).findOne({_id:id});if(!d)throw{status:404,message:"ERR_PRONOSTICO_PUBLICADO_NO_ENCONTRADO"};return d;}
}
export default EventosAgregadosPronosticadosPublicados.instance;
