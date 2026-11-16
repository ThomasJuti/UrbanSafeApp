#!/usr/bin/env bash
# Borra todo lo de la demo en AWS. La instancia se termina sola el viernes; esto limpia el resto
# (y la termina antes si sigue viva). Uso: bash deploy/teardown.sh
set -uo pipefail
R=sa-east-1
IID=$(aws ec2 describe-instances --region $R --filters Name=tag:Name,Values=urbansafe-demo Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text)
if [[ -n "$IID" ]]; then
  aws ec2 terminate-instances --region $R --instance-ids $IID >/dev/null
  aws ec2 wait instance-terminated --region $R --instance-ids $IID
  echo "Instancia $IID terminada"
fi
aws ec2 delete-security-group --region $R --group-name urbansafe-demo && echo "Security group borrado"
aws ec2 delete-key-pair --region $R --key-name urbansafe-demo && rm -f ~/.ssh/urbansafe-demo.pem && echo "Key pair borrado"
ACC=$(aws sts get-caller-identity --query Account --output text)
aws budgets delete-budget --account-id "$ACC" --budget-name urbansafe-demo && echo "Budget borrado"
