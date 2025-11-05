import { NextRequest, NextResponse } from "next/server";
import { Node, Edge, RawTriplet } from "@/lib/types/graph";
import { createTriplets } from "@/lib/utils/graph";
import { ZepClient } from "@getzep/zep-js";
import type { INode, IEdge } from "@getzep/zep-js";


interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}

const supportedResourceTypes = ["user", "group"] as const;
type ResourceType = (typeof supportedResourceTypes)[number];
const NODE_BATCH_SIZE = 100;
const EDGE_BATCH_SIZE = 100;

const transformSDKNode = (node: INode): Node => {
  return {
    uuid: node.uuid,
    name: node.name || "",
    summary: node.summary || "",
    labels: node.labels || [],
    created_at: node.created_at || "",
    updated_at: "",
    attributes: node.metadata || {}, // node.metadata no zep-js em vez de attributes
  };
};

// Atualizar a função para usar o tipo IEdge do zep-js
const transformSDKEdge = (edge: IEdge): Edge => {
  return {
    uuid: edge.uuid,
    source_node_uuid: edge.source_node_uuid, // campos podem ter nomes diferentes
    target_node_uuid: edge.target_node_uuid,
    type: "",
    name: edge.name || "",
    fact: edge.fact || "",
    episodes: edge.episodes || [],
    created_at: edge.created_at || "",
    updated_at: "",
    valid_at: edge.valid_at || null,
    expired_at: edge.expired_at || null,
    invalid_at: edge.invalid_at || null,
  };
};

async function getNodes(
  type: ResourceType,
  id: string,
  zep: ZepClient,
  cursor?: string
): Promise<PaginatedResponse<Node>> {
  try {
    let nodes;
    if (type === "user") {
      nodes = await zep.graph.getNodesByUserId(id, {
        cursor: cursor || "",
        limit: NODE_BATCH_SIZE,
      });
    } else {
      nodes = await zep.graph.getNodesByGroupId(id, {
        cursor: cursor || "",
        limit: NODE_BATCH_SIZE,
      });
    }
    
    const transformedNodes = nodes.map(transformSDKNode);
    return {
      data: transformedNodes,
      nextCursor: transformedNodes.length > 0 ? transformedNodes[transformedNodes.length - 1].uuid : null,
    };
  } catch (error) {
    console.error("Error fetching nodes:", error);
    return { data: [], nextCursor: null };
  }
}

async function getEdges(
  type: ResourceType, 
  id: string, 
  zep: ZepClient,
  cursor?: string
): Promise<PaginatedResponse<Edge>> {
  try {
    let edges;
    if (type === "user") {
      edges = await zep.graph.getEdgesByUserId(id, {
        cursor: cursor || "",
        limit: EDGE_BATCH_SIZE,
      });
    } else {
      edges = await zep.graph.getEdgesByGroupId(id, {
        cursor: cursor || "",
        limit: EDGE_BATCH_SIZE,
      });
    }
    
    const transformedEdges = edges.map(transformSDKEdge);
    return {
      data: transformedEdges,
      nextCursor: transformedEdges.length > 0 ? transformedEdges[transformedEdges.length - 1].uuid : null,
    };
  } catch (error) {
    console.error("Error fetching edges:", error);
    return { data: [], nextCursor: null };
  }
}

async function getAllNodes(
  type: ResourceType,
  id: string,
  zep: ZepClient
): Promise<Node[]> {
  let allNodes: Node[] = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    const { data: nodes, nextCursor } = await getNodes(type, id, zep, cursor);
    allNodes = [...allNodes, ...nodes];

    if (nextCursor === null || nodes.length === 0) {
      hasMore = false;
    } else {
      cursor = nextCursor;
    }
  }

  return allNodes;
}

async function getAllEdges(
  type: ResourceType,
  id: string,
  zep: ZepClient
): Promise<Edge[]> {
  let allEdges: Edge[] = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    const { data: edges, nextCursor } = await getEdges(type, id, zep, cursor);
    allEdges = [...allEdges, ...edges];

    if (nextCursor === null || edges.length === 0) {
      hasMore = false;
    } else {
      cursor = nextCursor;
    }
  }

  return allEdges;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: ResourceType; id: string }> }
) {
  try {
    const ZEP_API_KEY = process.env.ZEP_API_KEY;
    const ZEP_BASE_URL = process.env.ZEP_BASE_URL || "http://zep:8000"; // Add local baseURL

    if (!ZEP_API_KEY) {
      return NextResponse.json(
        { error: "ZEP_API_KEY is not set" },
        { status: 500 }
      );
    }

    // const zep = new ZepClient({ apiKey: ZEP_API_KEY });
    const zep = new ZepClient({
      apiKey: ZEP_API_KEY,
      baseURL: ZEP_BASE_URL
    });

    const { type, id } = await params;

    if (!supportedResourceTypes.includes(type as ResourceType)) {
      return NextResponse.json(
        { error: "Invalid resource type" },
        { status: 400 }
      );
    }

    // Fetch all nodes and edges using the batch completion wrappers
    const [nodes, edges] = await Promise.all([
      getAllNodes(type, id, zep),
      getAllEdges(type, id, zep),
    ]);

    if (!nodes.length && !edges.length) {
      return NextResponse.json({ triplets: [] });
    }

    // Combine nodes and edges into triplets
    const triplets = createTriplets(edges, nodes);

    return NextResponse.json({ triplets });
  } catch (error) {
    console.error("Error fetching triplets:", error);
    return NextResponse.json(
      { error: "Failed to fetch graph data" },
      { status: 500 }
    );
  }
}
