"""
services/validator.py — Python Source Code & Function Signature Validator
========================================================================
Validates user-submitted Python code using AST (Abstract Syntax Tree)
before sending deployments to Kubernetes.
"""

import ast
from typing import Optional, Tuple


def validate_python_code(code: str) -> Tuple[bool, Optional[str]]:
    """Validate Python syntax and verify required handler(event, context) signature.

    Returns:
        (True, None) if code is valid.
        (False, error_message) if syntax error or invalid handler signature.
    """
    if not code or not code.strip():
        return False, "Kod içeriği boş olamaz."

    # 1. Syntax validation
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        line_no = e.lineno or 1
        col_offset = e.offset or 0
        error_line = e.text.strip() if e.text else ""
        return (
            False,
            f"Python Sözdizimi Hatası (Satır {line_no}, Sütun {col_offset}): {e.msg}\n   → {error_line}",
        )

    # 2. Function definition and signature verification
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name in ("handler", "main"):
                args = node.args
                pos_args = len(args.args)
                has_varargs = args.vararg is not None
                defaults_count = len(args.defaults)
                min_required = pos_args - defaults_count

                # Runtime passes (event, context) — requires at least 2 positional args or varargs
                if has_varargs or (min_required <= 2 and pos_args >= 2) or pos_args == 2:
                    return True, None
                else:
                    param_names = [a.arg for a in args.args]
                    return (
                        False,
                        f"'{node.name}' fonksiyonu 'event' ve 'context' parametrelerini almalıdır.\n"
                        f"   Mevcut parametreler: ({', '.join(param_names)})\n"
                        f"   Beklenen imza: def {node.name}(event, context)",
                    )

    return (
        False,
        "Kodunuzda 'def handler(event, context)' veya 'def main(event, context)' fonksiyonu bulunamadı.",
    )
