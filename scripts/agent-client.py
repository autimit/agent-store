#!/usr/bin/env python3
"""Cliente HTTP de exemplo. Não usa um LLM e não implementa MCP/A2A."""
import argparse
import json
import urllib.error
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8091')
    parser.add_argument('--variant', default='aut-oliva-m')
    parser.add_argument('--quantity', type=int, default=1)
    parser.add_argument('--simulate-purchase', action='store_true', help='Autoriza criar e concluir uma compra fictícia, consumindo estoque de demonstração.')
    args = parser.parse_args()

    def request(path, body=None, headers=None):
        raw = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(args.url.rstrip('/') + path, raw, {'Content-Type': 'application/json', **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise SystemExit(error.read().decode()) from None

    metadata = request('/api/v1/store')
    if not metadata.get('demo') or metadata.get('checkout_mode') != 'simulation':
        raise SystemExit('Este cliente só opera em uma loja de demonstração.')
    items = [{'variant_id': args.variant, 'quantity': args.quantity}]
    shipping = {'postal_code': '01001000', 'service_id': 'standard'}
    request('/api/v1/shipping-quotes', {'items': items, 'postal_code': shipping['postal_code']})
    quote = request('/api/v1/quotes', {'items': items, 'shipping': shipping})
    print(json.dumps({'step': 'quote', 'result': quote}, ensure_ascii=False))
    if not args.simulate_purchase:
        return
    key = str(uuid.uuid4())
    # Repetir a mesma chave e corpo é seguro se houver resposta incerta.
    checkout = request('/api/v1/checkouts', {'items': items, 'payment_method': 'pix', 'shipping': shipping, 'delivery': {'full_name': 'Cliente Demo', 'email': 'demo@example.test', 'postal_code': '01001000', 'street': 'Rua de Teste', 'number': '100', 'neighborhood': 'Centro', 'city': 'São Paulo', 'state': 'SP'}}, {'Idempotency-Key': key})
    completed = request('/api/v1/checkouts/' + checkout['id'] + '/simulate-payment', {}, {'Authorization': 'Bearer ' + checkout['access_token']})
    print(json.dumps({'step': 'simulated_order', 'order_id': completed['order_id'], 'status': completed['status'], 'real_payment': completed['real_payment']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
