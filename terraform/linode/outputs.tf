output "kubeconfig" {
  value     = linode_lke_cluster.my_cluster.kubeconfig
  sensitive = true
}