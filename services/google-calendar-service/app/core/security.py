"""Token encryption and security utilities."""

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.exceptions import TokenEncryptionError


class TokenEncryptor:
    """AES-256-GCM encryption for OAuth tokens."""

    def __init__(self, master_key_b64: str):
        """
        Initialize encryptor with base64-encoded master key.

        Args:
            master_key_b64: Base64-encoded 32-byte key for AES-256
        """
        try:
            master_key = base64.b64decode(master_key_b64)
            if len(master_key) != 32:
                raise ValueError(f"Key must be 32 bytes, got {len(master_key)}")
            self.aesgcm = AESGCM(master_key)
            self.key_id = self._generate_key_id(master_key)
        except Exception as e:
            raise TokenEncryptionError("initialization", str(e))

    def _generate_key_id(self, key: bytes) -> str:
        """Generate a short identifier for the key version."""
        return hashlib.sha256(key).hexdigest()[:8]

    def encrypt(self, plaintext: str) -> tuple[str, str, str]:
        """
        Encrypt a token.

        Args:
            plaintext: The token to encrypt

        Returns:
            Tuple of (encrypted_token_b64, nonce_b64, key_id)
        """
        try:
            nonce = os.urandom(12)  # 96-bit nonce for GCM
            ciphertext = self.aesgcm.encrypt(
                nonce,
                plaintext.encode("utf-8"),
                None,  # No additional authenticated data
            )
            return (
                base64.b64encode(ciphertext).decode("utf-8"),
                base64.b64encode(nonce).decode("utf-8"),
                self.key_id,
            )
        except Exception as e:
            raise TokenEncryptionError("encryption", str(e))

    def decrypt(self, ciphertext_b64: str, nonce_b64: str) -> str:
        """
        Decrypt a token.

        Args:
            ciphertext_b64: Base64-encoded ciphertext
            nonce_b64: Base64-encoded nonce

        Returns:
            Decrypted plaintext token
        """
        try:
            ciphertext = base64.b64decode(ciphertext_b64)
            nonce = base64.b64decode(nonce_b64)
            plaintext = self.aesgcm.decrypt(nonce, ciphertext, None)
            return plaintext.decode("utf-8")
        except Exception as e:
            raise TokenEncryptionError("decryption", str(e))


class OAuthStateManager:
    """Manages OAuth state parameters for CSRF protection."""

    def __init__(self, secret_key: str, ttl_seconds: int = 600):
        """
        Initialize state manager.

        Args:
            secret_key: Secret for HMAC signing
            ttl_seconds: Time-to-live for state tokens (default 10 minutes)
        """
        self.secret_key = secret_key.encode("utf-8")
        self.ttl_seconds = ttl_seconds

    def generate_state(self, user_id: str) -> str:
        """
        Generate a signed state parameter.

        Args:
            user_id: The user ID to embed in state

        Returns:
            Signed state string: {random}.{user_id}.{timestamp}.{signature}
        """
        random_part = secrets.token_urlsafe(16)
        timestamp = int(datetime.now(timezone.utc).timestamp())
        payload = f"{random_part}.{user_id}.{timestamp}"
        signature = self._sign(payload)
        return f"{payload}.{signature}"

    def validate_state(self, state: str) -> Optional[str]:
        """
        Validate a state parameter and extract user_id.

        Args:
            state: The state string to validate

        Returns:
            user_id if valid, None if invalid or expired
        """
        try:
            parts = state.rsplit(".", 1)
            if len(parts) != 2:
                return None

            payload, signature = parts
            if not hmac.compare_digest(signature, self._sign(payload)):
                return None

            payload_parts = payload.split(".")
            if len(payload_parts) != 3:
                return None

            _, user_id, timestamp_str = payload_parts
            timestamp = int(timestamp_str)
            now = int(datetime.now(timezone.utc).timestamp())

            if now - timestamp > self.ttl_seconds:
                return None  # Expired

            return user_id
        except Exception:
            return None

    def _sign(self, payload: str) -> str:
        """Generate HMAC signature for payload."""
        return hmac.new(
            self.secret_key,
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:32]


def generate_encryption_key() -> str:
    """Generate a new 32-byte encryption key (for setup)."""
    return base64.b64encode(os.urandom(32)).decode("utf-8")


def generate_api_key() -> str:
    """Generate a secure API key (for setup)."""
    return secrets.token_urlsafe(32)
