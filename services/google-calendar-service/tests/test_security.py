"""Tests for security utilities."""

import pytest
from app.core.security import TokenEncryptor, OAuthStateManager, generate_encryption_key


class TestTokenEncryptor:
    """Tests for TokenEncryptor class."""

    @pytest.fixture
    def encryptor(self):
        """Create encryptor with test key."""
        key = generate_encryption_key()
        return TokenEncryptor(key)

    def test_encrypt_decrypt_round_trip(self, encryptor):
        """Test that encrypt/decrypt returns original value."""
        original = "test-refresh-token-12345"

        ciphertext, nonce, key_id = encryptor.encrypt(original)
        decrypted = encryptor.decrypt(ciphertext, nonce)

        assert decrypted == original

    def test_encrypted_value_is_different(self, encryptor):
        """Test that encrypted value differs from original."""
        original = "test-token"

        ciphertext, _, _ = encryptor.encrypt(original)

        assert ciphertext != original

    def test_different_nonces_produce_different_ciphertexts(self, encryptor):
        """Test that same plaintext produces different ciphertexts."""
        original = "test-token"

        ciphertext1, nonce1, _ = encryptor.encrypt(original)
        ciphertext2, nonce2, _ = encryptor.encrypt(original)

        assert ciphertext1 != ciphertext2
        assert nonce1 != nonce2

    def test_key_id_is_consistent(self, encryptor):
        """Test that key ID is consistent for same key."""
        _, _, key_id1 = encryptor.encrypt("token1")
        _, _, key_id2 = encryptor.encrypt("token2")

        assert key_id1 == key_id2


class TestOAuthStateManager:
    """Tests for OAuthStateManager class."""

    @pytest.fixture
    def state_manager(self):
        """Create state manager with test secret."""
        return OAuthStateManager(
            secret_key="test-secret-key",
            ttl_seconds=600,
        )

    def test_generate_and_validate_state(self, state_manager):
        """Test state generation and validation."""
        user_id = "test-user-123"

        state = state_manager.generate_state(user_id)
        validated_user_id = state_manager.validate_state(state)

        assert validated_user_id == user_id

    def test_invalid_state_returns_none(self, state_manager):
        """Test that invalid state returns None."""
        result = state_manager.validate_state("invalid-state")

        assert result is None

    def test_tampered_state_returns_none(self, state_manager):
        """Test that tampered state returns None."""
        state = state_manager.generate_state("user-123")
        tampered = state[:-5] + "xxxxx"

        result = state_manager.validate_state(tampered)

        assert result is None

    def test_expired_state_returns_none(self):
        """Test that expired state returns None."""
        # Create manager with 0 TTL
        manager = OAuthStateManager(
            secret_key="test-secret",
            ttl_seconds=0,
        )

        state = manager.generate_state("user-123")
        result = manager.validate_state(state)

        assert result is None
