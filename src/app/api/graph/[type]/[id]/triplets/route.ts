import { NextRequest, NextResponse } from "next/server";
import { Node, Edge } from "@/lib/types/graph";
import { createTriplets } from "@/lib/utils/graph";
// Importa o cliente Zep para uso local (open source version)
import { ZepClient } from "@getzep/zep-js";

// Interface para respostas paginadas (quando há muitos dados)
interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}

// Tipos de recursos suportados
// "user" = busca por ID de usuário
// "group" = busca por ID de sessão (session_id)
const supportedResourceTypes = ["user", "group"] as const;
type ResourceType = (typeof supportedResourceTypes)[number];

// Função que converte um nó do formato Zep para o formato usado no app
// Um "nó" representa uma entidade no grafo (pessoa, conceito, lugar, etc.)
const transformSDKNode = (node: any): Node => {
  return {
    uuid: node.uuid || "",
    name: node.name || "",
    summary: node.summary || "",
    labels: node.labels || [],
    created_at: node.created_at || "",
    updated_at: node.updated_at || "",
    // No Zep, os atributos extras ficam em "metadata"
    attributes: node.metadata || {},
  };
};

// Função que converte uma aresta do formato Zep para o formato usado no app
// Uma "aresta" (edge) representa uma conexão/relacionamento entre dois nós
const transformSDKEdge = (edge: any): Edge => {
  return {
    uuid: edge.uuid || "",
    source_node_uuid: edge.source_node_uuid || "",
    target_node_uuid: edge.target_node_uuid || "",
    type: edge.type || "",
    name: edge.name || "",
    fact: edge.fact || "",
    episodes: edge.episodes || [],
    created_at: edge.created_at || "",
    updated_at: edge.updated_at || "",
    valid_at: edge.valid_at || null,
    expired_at: edge.expired_at || null,
    invalid_at: edge.invalid_at || null,
  };
};

// Função que busca nós e arestas do grafo Zep
// O Zep local trabalha com "sessions" (sessões de chat)
async function getGraphData(
  type: ResourceType,
  id: string,
  zep: ZepClient
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  try {
    // IMPORTANTE: O Zep local (@getzep/zep-js) funciona baseado em sessões
    // Cada sessão tem suas próprias memórias e grafo associado
    
    // Para ambos os tipos (user e group), usamos o ID como session_id
    // pois é assim que o Zep local organiza os dados
    const sessionId = id;
    
    // Busca as memórias da sessão
    // O método getMemory retorna histórico de mensagens e sumários
    const memory = await zep.memory.getMemory(sessionId);
    
    // NOTA: O Zep local pode não retornar nós e arestas diretamente
    // Ele retorna principalmente mensagens, sumários e fatos extraídos
    // Se você precisa do grafo completo, pode ser necessário usar
    // uma versão mais recente do Zep ou a API REST diretamente
    
    // Tenta extrair dados do grafo se existirem
    const nodes = (memory as any)?.graph?.nodes || [];
    const edges = (memory as any)?.graph?.edges || [];
    
    return {
      nodes: nodes.map(transformSDKNode),
      edges: edges.map(transformSDKEdge),
    };
    
  } catch (error) {
    console.error("Erro ao buscar dados do grafo:", error);
    console.error("Detalhes:", error instanceof Error ? error.message : error);
    
    // Se der erro, retorna listas vazias em vez de quebrar a aplicação
    return { nodes: [], edges: [] };
  }
}

// Função principal que responde às requisições HTTP GET
// Esta função é chamada quando alguém faz uma requisição para esta API
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: ResourceType; id: string }> }
) {
  try {
    // Busca as configurações do ambiente (variáveis de ambiente)
    const ZEP_API_KEY = process.env.ZEP_API_KEY;
    const ZEP_BASE_URL = process.env.ZEP_BASE_URL || "http://localhost:8000";

    // Log para debug (ajuda a identificar problemas)
    console.log("Conectando ao Zep em:", ZEP_BASE_URL);
    
    if (!ZEP_API_KEY) {
      console.warn("⚠️  ZEP_API_KEY não configurada. Tentando conectar sem autenticação.");
    }

    // Inicializa o cliente Zep Local
    // IMPORTANTE: ZepClient.init() é assíncrono e retorna uma Promise
    // Por isso usamos "await" aqui
    const zep = await ZepClient.init(
      ZEP_BASE_URL,
      ZEP_API_KEY || undefined // undefined se não tiver chave
    );

    // Pega os parâmetros da URL
    // Exemplo: /api/graph/user/123 → type="user", id="123"
    const { type, id } = await params;

    console.log(`Buscando dados do grafo: tipo="${type}", id="${id}"`);

    // Valida se o tipo é válido (user ou group)
    if (!supportedResourceTypes.includes(type as ResourceType)) {
      return NextResponse.json(
        { 
          error: "Tipo de recurso inválido",
          message: 'Use "user" ou "group" como tipo',
          received: type
        },
        { status: 400 }
      );
    }

    // Busca nós e arestas do grafo
    const { nodes, edges } = await getGraphData(type, id, zep);

    console.log(`Encontrados: ${nodes.length} nós, ${edges.length} arestas`);

    // Se não encontrou nada, retorna lista vazia (não é erro)
    if (!nodes.length && !edges.length) {
      return NextResponse.json({ 
        triplets: [],
        message: "Nenhum dado de grafo encontrado para este ID",
        hint: "Certifique-se de que existem mensagens/dados adicionados para este usuário/sessão"
      });
    }

    // Combina nós e arestas em "triplets"
    // Triplets são estruturas de dados que facilitam a visualização do grafo
    const triplets = createTriplets(edges, nodes);

    // Retorna os dados em formato JSON
    return NextResponse.json({ 
      triplets,
      // Estatísticas úteis para debug
      stats: {
        nodes: nodes.length,
        edges: edges.length,
        triplets: triplets.length
      }
    });
    
  } catch (error) {
    // Se algo der errado, loga o erro completo
    console.error("❌ Erro ao buscar triplets:", error);
    
    // Retorna uma resposta de erro com detalhes úteis
    return NextResponse.json(
      { 
        error: "Falha ao buscar dados do grafo",
        details: error instanceof Error ? error.message : "Erro desconhecido",
        stack: error instanceof Error ? error.stack : undefined,
        hint: `Verifique se o Zep está rodando em ${process.env.ZEP_BASE_URL || "http://localhost:8000"}`
      },
      { status: 500 }
    );
  }
}