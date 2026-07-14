import fetch from "node-fetch";
import mongo from "./MongoDB.js";
import temblores from "./Temblores.js";
import Proceso from "./Proceso.js";
import procesaTembloresDescargados from "./ProcesaTembloresDescargados.js";
import FuentesTemblores from "./FuentesTemblores.js";

const DESCARGA_ID = "temblores-fuentes";
const MAX_FEATURES_POR_BLOQUE = 20000;
const SOLAPE_INCREMENTAL_MS = 7 * 24 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

class DescargaTemblores extends Proceso {
    static get instance() {
        if (DescargaTemblores._singleton) return DescargaTemblores._singleton;
        DescargaTemblores._singleton = new DescargaTemblores();
        return DescargaTemblores._singleton;
    }

    get codigo() { return "descarga-temblores"; }
    get nombre() { return "Descarga de temblores por fuentes priorizadas"; }
    get descripcion() {
        return "Descarga eventos desde fuentes globales y locales, dando preferencia espacial y temporal a las fuentes confiables";
    }

    async ejecutaDescargaPendiente(options = {}) { return await this.ejecuta(options); }

    async run() {
        this.config = new FuentesTemblores();
        const estado = await this.leeEstadoDescarga();
        const resultado = (!estado || !estado.ultimoTiempo)
            ? await this.descargaInicialCompleta()
            : await this.descargaIncremental();
        await this.logResumenDescarga(resultado);
        await this.iniciaProcesamientoTemblores(resultado);
        return resultado;
    }

    async descargaInicialCompleta() {
        const configurado = process.env.TEMBLORES_START_DATE;
        const inicio = new Date(configurado || this.config.inicioMasAntiguo);
        const fin = new Date();
        if (isNaN(inicio.getTime())) throw new Error("ERR_FECHA_INICIO_TEMBLORES_INVALIDA");
        await this.logInfo(`Iniciando descarga historica multifuente desde ${inicio.toISOString()} hasta ${fin.toISOString()}`);
        return await this.descargaRango(inicio, fin);
    }

    async descargaIncremental() {
        const estado = await this.leeEstadoDescarga();
        const ultimoTiempo = estado?.ultimoTiempo || await temblores.getUltimoTiempoTemblor();
        if (!ultimoTiempo) return await this.descargaInicialCompleta();
        const inicio = new Date(Math.max(0, Number(ultimoTiempo) - SOLAPE_INCREMENTAL_MS));
        const fin = new Date();
        await this.logInfo(`Iniciando descarga incremental multifuente desde ${inicio.toISOString()} hasta ${fin.toISOString()}`);
        return await this.descargaRango(inicio, fin);
    }

    async descargaRango(inicio, fin) {
        try {
            let actual = new Date(inicio);
            let total = 0;
            let bloques = 0;
            const porFuente = {};
            while (actual < fin) {
                await this.verificaDetencionSolicitada();
                const siguiente = this.minDate(this.inicioSiguienteAnio(actual), fin);
                const resultado = await this.descargaBloqueAdaptativo(actual, siguiente);
                total += resultado.descargados;
                bloques += resultado.bloques;
                for (const [fuente, cantidad] of Object.entries(resultado.porFuente || {})) {
                    porFuente[fuente] = (porFuente[fuente] || 0) + cantidad;
                }
                actual = siguiente;
            }
            await this.actualizaEstadoDescarga({ estado: "ok", bloqueActual: null, mensaje: null, ultimaEjecucionUTC: new Date().toISOString() });
            return { estado: "ok", descargados: total, bloques, porFuente };
        } catch (error) {
            await this.actualizaEstadoDescarga({
                estado: "error", mensaje: error?.message || String(error), bloqueActual: null,
                ultimaEjecucionUTC: new Date().toISOString()
            });
            throw error;
        }
    }

    async descargaBloqueAdaptativo(inicio, fin) {
        await this.actualizaEstadoDescarga({
            estado: "ejecutando",
            bloqueActual: { inicioUTC: inicio.toISOString(), finUTC: fin.toISOString() },
            mensaje: null,
            ultimaEjecucionUTC: new Date().toISOString()
        });
        try {
            const usgs = this.config.fuentes.find(f => f.tipo === "usgs-fdsn" && this.vigenteEnRango(f, inicio, fin));
            if (usgs) {
                const json = await this.invocaUSGS(usgs, inicio, fin);
                if (json.features.length >= MAX_FEATURES_POR_BLOQUE && this.puedeDividir(inicio, fin)) {
                    return await this.descargaBloqueDividido(inicio, fin);
                }
                return await this.descargaYGuardaFuentes(inicio, fin, usgs, json);
            }
            return await this.descargaYGuardaFuentes(inicio, fin, null, null);
        } catch (error) {
            if (!this.puedeDividir(inicio, fin)) throw error;
            await this.logWarning(`Dividiendo bloque ${inicio.toISOString()} - ${fin.toISOString()} por error: ${error?.message || error}`);
            return await this.descargaBloqueDividido(inicio, fin);
        }
    }

    async descargaYGuardaFuentes(inicio, fin, fuenteUSGS, respuestaUSGS) {
        const candidatos = [];
        const diasConsultados = new Map();
        if (fuenteUSGS && respuestaUSGS) {
            diasConsultados.set(fuenteUSGS.codigo, null); // Una fuente sin area cubre todo el rango.
            candidatos.push(...respuestaUSGS.features.map(f => this.transformaFeatureUSGS(f, fuenteUSGS)).filter(Boolean));
        }

        for (const fuente of this.config.fuentes.filter(f => f.tipo === "csn-html-diario" && this.vigenteEnRango(f, inicio, fin))) {
            const resultado = await this.descargaCSNRango(fuente, inicio, fin);
            candidatos.push(...resultado.temblores);
            diasConsultados.set(fuente.codigo, resultado.diasConsultados);
        }

        const seleccionados = candidatos.filter(t => {
            const fuente = this.config.fuentes.find(f => f.codigo === t.fuente);
            if (!this.config.cubre(fuente, t)) return false;
            return !this.hayFuentePreferenteConsultada(fuente, t, diasConsultados);
        });
        await temblores.guardaTemblores(seleccionados);
        await this.actualizaUltimoTiempo(seleccionados, fin);
        const porFuente = seleccionados.reduce((r, t) => ({ ...r, [t.fuente]: (r[t.fuente] || 0) + 1 }), {});
        await this.logInfo(`Bloque consolidado: ${seleccionados.length} eventos`, porFuente);
        return { descargados: seleccionados.length, bloques: 1, porFuente };
    }

    hayFuentePreferenteConsultada(fuenteActual, temblor, diasConsultados) {
        const dia = this.claveDia(temblor.tiempo);
        return this.config.fuentes.some(otra => {
            if (otra.prioridad <= fuenteActual.prioridad || !this.config.cubre(otra, temblor)) return false;
            const consultados = diasConsultados.get(otra.codigo);
            return consultados === null || consultados?.has(dia);
        });
    }

    async descargaCSNRango(fuente, inicio, fin) {
        const tembloresCSN = [];
        const diasConsultados = new Set();
        let dia = this.inicioDiaUTC(new Date(Math.max(inicio.getTime(), fuente.desdeTiempo)));
        while (dia < fin) {
            await this.verificaDetencionSolicitada();
            try {
                const respuesta = await this.invocaCSNDia(fuente, dia);
                diasConsultados.add(this.claveDia(dia));
                tembloresCSN.push(...respuesta.filter(t => t.tiempo >= inicio.getTime() && t.tiempo < fin.getTime()));
            } catch (error) {
                // Sin confirmacion local no se elimina la alternativa global para ese dia.
                await this.logWarning(`No se obtuvo ${fuente.codigo} para ${this.claveDia(dia)}; se conserva la fuente global`, error?.message || error);
            }
            dia = new Date(dia.getTime() + DIA_MS);
            if (fuente.esperaEntreConsultasMs) await new Promise(resolve => setTimeout(resolve, Number(fuente.esperaEntreConsultasMs)));
        }
        return { temblores: tembloresCSN, diasConsultados };
    }

    async invocaCSNDia(fuente, dia) {
        const yyyy = String(dia.getUTCFullYear());
        const mm = String(dia.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(dia.getUTCDate()).padStart(2, "0");
        const yyyymmdd = `${yyyy}${mm}${dd}`;
        const url = fuente.url.replace("{yyyy}", yyyy).replace("{mm}", mm).replace("{dd}", dd).replace("{yyyymmdd}", yyyymmdd);
        const response = await fetch(url, { headers: { "User-Agent": "EQ/1.0 catalog integration" } });
        if (!response.ok) throw new Error(`${fuente.codigo} ${response.status}: ${url}`);
        return this.parseaCSN(await response.text(), fuente, url);
    }

    parseaCSN(html, fuente, url) {
        const eventos = [];
        const filas = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
        for (const fila of filas) {
            const celdas = [...fila.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(m => ({ attrs: m[1], html: m[2] }));
            if (celdas.length < 5) continue;
            const fechaUTC = this.textoHTML(celdas[1].html).match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/)?.[0];
            const coordenadas = this.textoHTML(celdas[2].html).match(/-?\d+(?:\.\d+)?/g)?.map(Number);
            const profundidad = Number(this.textoHTML(celdas[3].html).match(/-?\d+(?:\.\d+)?/)?.[0]);
            const magnitudTexto = this.textoHTML(celdas[4].html);
            const magnitudMatch = magnitudTexto.match(/(-?\d+(?:\.\d+)?)\s*([A-Za-z0-9_]+)/);
            if (!fechaUTC || !coordenadas || coordenadas.length < 2 || !magnitudMatch) continue;
            const tiempo = Date.parse(fechaUTC.replace(" ", "T") + "Z");
            const href = celdas[0].html.match(/href=["']([^"']+)["']/i)?.[1] || null;
            const idOrigen = href?.match(/\/([^/]+)\.html(?:\?|$)/)?.[1] || `${tiempo}-${coordenadas[0]}-${coordenadas[1]}`;
            const ubicacion = this.textoHTML(celdas[0].html).replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*/, "").trim() || null;
            eventos.push({
                _id: `${fuente.codigo}:${idOrigen}`, idOrigen, fuente: fuente.codigo,
                fechaUTC: new Date(tiempo).toISOString(), tiempo,
                latitud: coordenadas[0], longitud: coordenadas[1],
                profundidadKm: Number.isFinite(profundidad) ? profundidad : null,
                magnitud: Number(magnitudMatch[1]), tipoMagnitud: magnitudMatch[2].toLowerCase(),
                ubicacionFuente: ubicacion, urlFuente: href ? new URL(href, url).toString() : url,
                procesado: false, valido: false
            });
        }
        return eventos;
    }

    textoHTML(html) {
        return html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ").replace(/&deg;/gi, "°").replace(/&amp;/gi, "&")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();
    }

    async invocaUSGS(fuente, inicio, fin) {
        const params = new URLSearchParams({
            format: "geojson", starttime: inicio.toISOString(), endtime: fin.toISOString(),
            orderby: "time-asc", limit: String(MAX_FEATURES_POR_BLOQUE)
        });
        await this.logInfo(`Descargando ${fuente.codigo}: ${inicio.toISOString()} - ${fin.toISOString()}`);
        const response = await fetch(`${fuente.url}?${params.toString()}`);
        if (!response.ok) throw new Error(`${fuente.codigo} ${response.status}: ${await response.text()}`);
        const json = await response.json();
        if (!Array.isArray(json?.features)) throw new Error(`${fuente.codigo}: respuesta GeoJSON invalida`);
        return json;
    }

    transformaFeatureUSGS(feature, fuente) {
        if (!feature?.id || !feature?.properties || !feature?.geometry) return null;
        const coordinates = feature.geometry.coordinates || [];
        const tiempo = Number(feature.properties.time);
        if (!Number.isFinite(tiempo)) return null;
        const magnitud = feature.properties.mag == null ? null : Number(feature.properties.mag);
        return {
            _id: `${fuente.codigo}:${feature.id}`, idOrigen: feature.id, fuente: fuente.codigo,
            fechaUTC: new Date(tiempo).toISOString(), tiempo,
            latitud: coordinates[1], longitud: coordinates[0], profundidadKm: coordinates[2] ?? null,
            magnitud: Number.isFinite(magnitud) ? magnitud : null,
            tipoMagnitud: feature.properties.magType?.toLowerCase() || null,
            ubicacionFuente: feature.properties.place || null, urlFuente: feature.properties.url || null,
            procesado: false, valido: false
        };
    }

    async descargaBloqueDividido(inicio, fin) {
        const medio = new Date(Math.floor((inicio.getTime() + fin.getTime()) / 2));
        const r1 = await this.descargaBloqueAdaptativo(inicio, medio);
        const r2 = await this.descargaBloqueAdaptativo(medio, fin);
        const porFuente = { ...r1.porFuente };
        for (const [f, n] of Object.entries(r2.porFuente || {})) porFuente[f] = (porFuente[f] || 0) + n;
        return { descargados: r1.descargados + r2.descargados, bloques: r1.bloques + r2.bloques, porFuente };
    }

    vigenteEnRango(fuente, inicio, fin) { return fuente.desdeTiempo < fin.getTime() && fuente.hastaTiempo > inicio.getTime(); }
    inicioDiaUTC(date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
    claveDia(valor) { return new Date(valor).toISOString().slice(0, 10); }
    inicioSiguienteAnio(date) { return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1)); }
    minDate(a, b) { return a < b ? a : b; }
    puedeDividir(inicio, fin) { return fin.getTime() - inicio.getTime() > DIA_MS; }

    async leeEstadoDescarga() { return await (await mongo.collection("descargas")).findOne({ _id: DESCARGA_ID }); }
    async actualizaEstadoDescarga(cambios) {
        const col = await mongo.collection("descargas");
        await col.updateOne({ _id: DESCARGA_ID }, {
            $set: { fuente: "MULTIFUENTE", coleccion: "temblores", ...cambios }, $setOnInsert: { _id: DESCARGA_ID }
        }, { upsert: true });
    }
    async actualizaUltimoTiempo(eventos, finRango) {
        const maxEvento = Math.max(...eventos.map(t => t.tiempo).filter(Number.isFinite), 0);
        // Avanzar por el rango consultado evita repetir eternamente días sin eventos.
        const ultimoTiempo = Math.max(maxEvento, finRango.getTime());
        await this.actualizaEstadoDescarga({ ultimoTiempo, ultimaFechaUTC: new Date(ultimoTiempo).toISOString() });
    }
    async getTotalTemblores() { return await (await mongo.collection("temblores")).countDocuments(); }
    async logResumenDescarga(resultado) {
        resultado.totalBaseDatos = await this.getTotalTemblores();
        await this.logInfo(`Resumen descarga: ${resultado.descargados || 0} eventos consolidados; ${resultado.totalBaseDatos} totales`, resultado.porFuente);
    }
    async iniciaProcesamientoTemblores(resultado) {
        if (!Number(resultado?.descargados || 0)) return;
        resultado.procesamientoTemblores = await procesaTembloresDescargados.ejecutaAsync({
            origen: this.codigo, descargaEjecucionId: this.ejecucionId || null,
            descargados: resultado.descargados, bloques: resultado.bloques,
            totalBaseDatos: resultado.totalBaseDatos, porFuente: resultado.porFuente
        });
    }
}

export { DescargaTemblores };
export default Proceso.registra(DescargaTemblores.instance);
