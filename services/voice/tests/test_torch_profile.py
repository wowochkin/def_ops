import json
import pytest


def test_profile_defaults_and_validation(tmp_path):
    from torch_profile import load_torch_profile
    assert load_torch_profile(tmp_path).quantization == 'bf16'
    (tmp_path / 'torch-profile.json').write_text(json.dumps({'managed': True, 'quantization': 'nf4', 'attention': 'sdpa'}))
    profile = load_torch_profile(tmp_path)
    assert profile.managed and profile.quantization == 'nf4'
    (tmp_path / 'torch-profile.json').write_text(json.dumps({'managed': True, 'quantization': 'invalid', 'attention': 'sdpa'}))
    with pytest.raises(ValueError):
        load_torch_profile(tmp_path)
