import mongo from "./MongoDB.js";

const fecha = (title, description) => ({type:"string",format:"date-time",title,description});
const numero = (title, defecto, minimum=0, advanced=true) => ({type:"number",title,default:defecto,minimum,"ui:advanced":advanced});
const entero = (title, defecto, minimum=1, advanced=true) => ({type:"integer",title,default:defecto,minimum,"ui:advanced":advanced});
const placas = {type:"array",items:{type:"string"},title:"Placas",description:"Códigos separados por coma; vacío procesa todas"};
const rango = {desde:fecha("Desde","Inicio inclusivo del rango"),hasta:fecha("Hasta","Fin exclusivo del rango")};
const PARAMETROS = {
    "descarga-temblores": {type:"object",properties:{}},
    "procesa-temblores-descargados": {type:"object",properties:{...rango,batchSize:entero("Tamaño de bloque",1000),distanciaMaximaBordeKm:numero("Distancia máxima al borde (km)",300)}},
    clusteriza: {type:"object",properties:{...rango,placas,perfil:{type:"string",title:"Perfil",default:"actual","ui:advanced":true},batchSize:entero("Tamaño de bloque",2000),binKm:numero("Tamaño de celda (km)",100)}},
    "entrenar-modelo": {type:"object",properties:{...rango,placas,contextSize:entero("Eventos de contexto",32,2),maxEpochs:entero("Máximo de épocas",50),patience:entero("Paciencia",8),validationFraction:numero("Fracción de validación",0.2,0.05),batchSize:entero("Tamaño de bloque",1024,32)}},
    "evaluar-modelo": {type:"object",properties:{...rango,placas,modeloPath:{type:"string",title:"Ruta del modelo"},horizonteEventos:entero("Horizonte de eventos",10),cortesPorPlaca:entero("Cortes por placa",20),trayectoriasPorCorte:entero("Trayectorias por corte",200),maxEventosPorPlaca:entero("Máximo de eventos por placa",50000)}},
    "generar-pronostico": {type:"object",properties:{fechaProceso:fecha("Fecha del proceso","Ejecución única; el pronóstico solo verá información disponible hasta este instante"),fechaInicio:fecha("Fecha de inicio","Primer día inclusivo del rango; se procesa a las 00:00 locales"),fechaTermino:fecha("Fecha de término","Último día inclusivo; si se omite, usa el día calendario actual"),placas,modeloPath:{type:"string",title:"Ruta del modelo"},horizonteEventos:entero("Horizonte de eventos",30),cantidadTrayectorias:entero("Cantidad de trayectorias",500),factorRadioContinuidad:numero("Factor de radio de continuidad",1.5,0.01),toleranciaContinuidadHoras:numero("Tolerancia de continuidad (horas)",24,0),scoreMaximoContinuidad:numero("Score máximo de continuidad",3,0),factorRadioConsolidacion:numero("Factor de radio de consolidación",1,0.01)}},
    "geocodificar-pronostico": {type:"object",properties:{pronosticoId:{type:"string",title:"ID de pronóstico"},soloPendientes:{type:"boolean",title:"Solo pendientes",default:true},forzar:{type:"boolean",title:"Forzar actualización",default:false}}},
    "sincronizar-localidades": {type:"object",properties:{baseUrl:{type:"string",title:"URL base","ui:advanced":true}}}
};

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

    get parametros() { return PARAMETROS[this.codigo] || {type:"object",properties:{}}; }

    validaOptions(options = {}) {
        if (!options || typeof options !== "object" || Array.isArray(options)) throw {status:400,message:"ERR_PARAMETROS_INVALIDOS"};
        const schema=this.parametros, properties=schema.properties||{}, salida={};
        for(const [nombre,valorOriginal] of Object.entries(options)){
            if(!(nombre in properties)){salida[nombre]=valorOriginal;continue}
            if(valorOriginal===undefined||valorOriginal===null||valorOriginal==="")continue;
            const def=properties[nombre]; let valor=valorOriginal;
            if(def.type==="array"&&typeof valor==="string")valor=valor.split(",").map(v=>v.trim()).filter(Boolean);
            if(def.type==="integer"||def.type==="number"){
                valor=Number(valor); if(!Number.isFinite(valor)||(def.type==="integer"&&!Number.isInteger(valor))||(def.minimum!==undefined&&valor<def.minimum))throw{status:400,message:`ERR_PARAMETRO_INVALIDO: ${nombre}`};
            }
            if(def.type==="boolean"&&typeof valor!=="boolean")valor=String(valor)==="true";
            if(def.format==="date-time"){
                const ms=Date.parse(valor); if(Number.isNaN(ms))throw{status:400,message:`ERR_FECHA_INVALIDA: ${nombre}`}; valor=new Date(ms).toISOString();
            }
            salida[nombre]=valor;
        }
        if(salida.desde&&salida.hasta&&Date.parse(salida.desde)>=Date.parse(salida.hasta))throw{status:400,message:"ERR_RANGO_FECHAS_INVALIDO"};
        if(!salida.fechaInicio&&salida.fechaTermino)throw{status:400,message:"ERR_RANGO_PRONOSTICO_SIN_INICIO"};
        if(salida.fechaInicio&&salida.fechaTermino&&Date.parse(salida.fechaInicio)>Date.parse(salida.fechaTermino))throw{status:400,message:"ERR_RANGO_FECHAS_INVALIDO"};
        if(salida.fechaProceso&&(salida.fechaInicio||salida.fechaTermino))throw{status:400,message:"ERR_FECHA_PROCESO_Y_RANGO_INCOMPATIBLES"};
        return salida;
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
