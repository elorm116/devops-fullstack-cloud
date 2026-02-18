terraform {
  required_providers {
    linode = {
      source  = "linode/linode"
      version = "3.8.0"
    }
  }
}

provider "linode" {
  token = var.linode_token
}

# The Kubernetes Cluster
resource "linode_lke_cluster" "my_cluster" {
  label       = "devops-cluster"
  k8s_version = "1.34"
  region      = "in-maa" # Choose a region near you
  tags        = ["devops"]

  pool {
    type  = "g6-standard-1" # This is a 2GB RAM node (cheap for testing!)
    count = 3               # 3 nodes for a proper K8s experience
  }
}
