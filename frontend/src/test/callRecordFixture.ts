import type { CallRecord } from '../types/api';

/** The call record of the sample TranslatedPRI.xml (fictitious values), as the API gives it. */
export const CALL_RECORD: CallRecord = {
  source_name: 'TranslatedPRI.xml',
  sha256: 'a'.repeat(64),
  imported_by: 'ana',
  imported_at: '2026-11-26T15:00:00Z',
  history: [],
  guid_matches_audio: true,
  data: {
    attributes: {
      Caso: '00000-25.0JGLSB',
      ID_do_Produto: '987391358095330748',
      Hora_de_início: '17-11-2026 20:31:50',
      Caminho_do_produto: '\\\\aaaaaa',
      GUID: 'E153C371F8FC8B168A67E7DA3347B76D',
    },
    elements: [
      {
        tag: 'Participantes_do_produto',
        attributes: { Tipo_de_participante: '1', Identificador_do_participante: '351912052349' },
      },
      {
        tag: 'Participantes_do_produto',
        attributes: { Tipo_de_participante: '2', Identificador_do_participante: '351915592482' },
      },
      {
        tag: 'Coordenadas_da_célula',
        attributes: {
          Tipo_de_evento: 'Célula Inicial',
          Coordenada_X_da_célula: '-9.32859',
          Coordenada_Y_da_célula: '38.68433',
        },
      },
      {
        tag: 'Etiqueta',
        attributes: {
          Hora: '17-11-2026 20:32:10',
          Evento: 'Etiqueta do Comutador',
          Tipo: 'Atendida',
        },
      },
      { tag: 'Dados_em_bruto', attributes: { Relativo_a: 'Dados em bruto' } },
    ],
    summary: {
      product_id: '987391358095330748',
      target_product_number: '2414',
      product_type: 'Voz',
      product_subtype: 'Não Aplicável',
      protocol: 'VOIP',
      start: '17-11-2026 20:31:50',
      end: '17-11-2026 20:32:48',
      duration_seconds: 58,
      answered_at: '17-11-2026 20:32:10',
      direction: 'Desconhecido',
      caller: '351912052349',
      callee: '+351915592482',
      recorded: 'Completamente gravado',
      end_reason: 'Desconhecido',
      case: '00000-25.0JGLSB',
      subcase: 'ALVOS',
      target: '111222333',
      target_number: '911111',
      interception_id: '147277040',
      interception_criterion: 'ID da Interceção Legal',
      guid: 'E153C371F8FC8B168A67E7DA3347B76D',
    },
  },
};
